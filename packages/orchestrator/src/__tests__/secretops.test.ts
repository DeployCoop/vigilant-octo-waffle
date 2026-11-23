/**
 * SecretOps wiring tests (Batch C, Phase 1): the audit and rotation run
 * against real cluster reads. The cluster and the executor are faked
 * through the deps seam; the tests assert the module calls the right
 * real operations with the right args, verifies the restart, and
 * surfaces errors — never fabricated values.
 *
 * Planted credential values below are obvious test fixtures (the AWS
 * example key, repeated-char tokens); the "never leaks values" test
 * asserts none of them reaches the report.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditSecretsAndLeaks,
  rotateSecretCredential,
  type SecretOpsCluster,
  type SecretOpsDeps,
} from '../secretops.js';
import { ClusterUnavailableError } from '../errors.js';
import type {
  ClusterTelemetry,
  ConfigMapInfo,
  ExternalSecretsStatus,
  PodSpecInfo,
  SecretDetail,
  SecretInfo,
} from '../k8s.js';
import type { CommandWaitResult, RunCommandOptions } from '../executor.js';

const DAY_MS = 86400000;
const NOW = Date.parse('2026-11-12T12:00:00Z');

function connectedTelemetry(): ClusterTelemetry {
  return {
    isConnected: true,
    context: 'test',
    detectedPlatform: 'kind',
    detectedClusterName: 'test',
    nodeCount: 1,
    podCount: 1,
    namespaceCount: 1,
    ingressCount: 0,
    nodes: [],
    namespaces: ['default'],
    ingresses: [],
    // Fleet slice extended ClusterTelemetry; secretops never reads these.
    k8sVersion: 'v1.31.2',
    cpuCapacityCores: 8,
    memoryCapacityGb: 16,
    server: 'https://127.0.0.1:6443',
  };
}

function offlineTelemetry(): ClusterTelemetry {
  return { ...connectedTelemetry(), isConnected: false, nodeCount: 0, podCount: 0 };
}

function b64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

class FakeCluster implements SecretOpsCluster {
  telemetry: ClusterTelemetry = connectedTelemetry();
  secrets: SecretDetail[] = [];
  configMaps: ConfigMapInfo[] = [];
  pods: PodSpecInfo[] = [];
  eso: ExternalSecretsStatus = {
    installed: false,
    externalSecretCount: 0,
    readyExternalSecretCount: 0,
    storeReady: false,
  };

  async getTelemetry(): Promise<ClusterTelemetry> {
    return this.telemetry;
  }

  async getSecrets(): Promise<SecretInfo[]> {
    return this.secrets.map((s) => ({
      name: s.name,
      namespace: s.namespace,
      type: s.type,
      creationTimestamp: s.creationTimestamp,
      annotations: s.annotations,
      labels: s.labels,
      ownerKinds: s.ownerKinds,
      dataKeys: s.dataKeys,
      resourceVersion: s.resourceVersion,
      immutable: s.immutable,
    }));
  }

  async getSecret(name: string, namespace: string): Promise<SecretDetail | null> {
    const found = this.secrets.find((s) => s.name === name && s.namespace === namespace);
    return found ? { ...found, data: { ...found.data } } : null;
  }

  async getConfigMaps(): Promise<ConfigMapInfo[]> {
    return this.configMaps;
  }

  async getPodSpecs(): Promise<PodSpecInfo[]> {
    return this.pods;
  }

  async getExternalSecretsStatus(): Promise<ExternalSecretsStatus> {
    return this.eso;
  }

  /** Simulate `kubectl apply -f -` landing: replace data + annotations, bump resourceVersion. */
  applyManifest(manifestJson: string): void {
    const obj = JSON.parse(manifestJson) as {
      metadata: { name: string; namespace: string; annotations?: Record<string, string> };
      data: Record<string, string>;
    };
    const target = this.secrets.find(
      (s) => s.name === obj.metadata.name && s.namespace === obj.metadata.namespace
    );
    if (!target) throw new Error('apply to unknown secret in fixture');
    target.data = { ...obj.data };
    target.annotations = { ...(obj.metadata.annotations ?? {}) };
    target.resourceVersion = String(Number(target.resourceVersion ?? '0') + 1);
  }
}

interface RunCall {
  command: string;
  args: string[];
  input?: string;
}

function okResult(stdout = ''): CommandWaitResult {
  return { code: 0, status: 'completed', logs: [], stdout, stderr: '', taskId: 't-ok' };
}

function failResult(stderr: string): CommandWaitResult {
  return { code: 1, status: 'failed', logs: [], stdout: '', stderr, taskId: 't-fail' };
}

interface RunHarness {
  run: NonNullable<SecretOpsDeps['run']>;
  calls: RunCall[];
}

/**
 * Fake executor: apply mutates the fake cluster, `get replicaset`
 * resolves owners from the given map, rollout commands succeed unless
 * `failOn` says otherwise.
 */
function makeRun(
  cluster: FakeCluster,
  rsOwners: Map<string, string>,
  failOn?: (command: string, args: string[]) => string | null
): RunHarness {
  const calls: RunCall[] = [];
  const run = async (
    command: string,
    args: string[],
    options: RunCommandOptions
  ): Promise<CommandWaitResult> => {
    calls.push({
      command,
      args,
      input: typeof options.input === 'string' ? options.input : undefined,
    });
    const failure = failOn?.(command, args);
    if (failure) return failResult(failure);
    if (command === 'kubectl' && args[0] === 'apply') {
      if (typeof options.input === 'string') cluster.applyManifest(options.input);
      return okResult();
    }
    if (command === 'kubectl' && args[0] === 'get' && args[1] === 'replicaset') {
      const owner = rsOwners.get(args[2]);
      return okResult(
        JSON.stringify({
          metadata: {
            ownerReferences: owner ? [{ kind: 'Deployment', name: owner }] : [],
          },
        })
      );
    }
    return okResult();
  };
  return { run, calls };
}

function secretDetail(partial: Partial<SecretDetail> & { name: string; namespace: string }): SecretDetail {
  return {
    type: 'Opaque',
    creationTimestamp: new Date(NOW - 10 * DAY_MS).toISOString(),
    annotations: {},
    labels: {},
    ownerKinds: [],
    dataKeys: ['password'],
    resourceVersion: '100',
    data: { password: b64('old-password-value') },
    ...partial,
  };
}

function podSpec(partial: Partial<PodSpecInfo> & { name: string; namespace: string }): PodSpecInfo {
  return { containers: [], volumes: [], ...partial };
}

describe('auditSecretsAndLeaks — real data derivation', () => {
  function auditCluster(): FakeCluster {
    const cluster = new FakeCluster();
    cluster.pods = [
      podSpec({
        name: 'legacy-0',
        namespace: 'default',
        containers: [
          {
            name: 'legacy',
            env: [
              {
                name: 'SSH_KEY',
                value: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7fixture\n-----END RSA PRIVATE KEY-----',
              },
            ],
            envFromSecrets: [],
            envFromConfigMaps: [],
            args: [],
          },
        ],
      }),
      podSpec({
        name: 'web-abc',
        namespace: 'default',
        containers: [
          {
            name: 'web',
            env: [
              { name: 'AWS_ACCESS_KEY_ID', value: 'AKIAIOSFODNN7EXAMPLE' },
              { name: 'DB_PASSWORD', value: 's3cr3t-db-value' },
              { name: 'API_TOKEN', valueFromKind: 'secretKeyRef', valueFromName: 'api-tokens', valueFromKey: 'token' },
              { name: 'NORMAL_VAR', value: 'hello' },
            ],
            envFromSecrets: [],
            envFromConfigMaps: [],
            args: [`--github-token=ghp_${'a'.repeat(36)}`],
          },
        ],
      }),
      podSpec({
        name: 'worker-xyz',
        namespace: 'jobs',
        containers: [
          {
            name: 'worker',
            env: [{ name: 'HIGH_ENTROPY_KEY', value: 'xK9mQ2vL8pR4tY6wN3bV7cD1fH5jK9m' }],
            envFromSecrets: [],
            envFromConfigMaps: [],
            args: [],
          },
        ],
      }),
    ];
    cluster.configMaps = [
      {
        name: 'app-config',
        namespace: 'default',
        data: { REDIS_ADMIN_PASSWORD: 'redis-secret-value', PLAIN: 'hello' },
      },
    ];
    cluster.secrets = [
      secretDetail({
        name: 'db-creds',
        namespace: 'postgres',
        creationTimestamp: new Date(NOW - 124 * DAY_MS).toISOString(),
      }),
      secretDetail({
        name: 'tls-cert',
        namespace: 'traefik',
        type: 'kubernetes.io/tls',
        creationTimestamp: new Date(NOW - 14 * DAY_MS).toISOString(),
        labels: { 'cert-manager.io/certificate-name': 'wildcard' },
        dataKeys: ['tls.crt', 'tls.key'],
        data: { 'tls.crt': b64('cert'), 'tls.key': b64('key') },
      }),
      secretDetail({
        name: 'eso-secret',
        namespace: 'default',
        ownerKinds: ['ExternalSecret'],
        dataKeys: ['token'],
        data: { token: b64('vault-token') },
      }),
      secretDetail({
        name: 'argo-secret',
        namespace: 'argocd',
        creationTimestamp: new Date(NOW - 45 * DAY_MS).toISOString(),
        labels: { 'app.kubernetes.io/managed-by': 'argocd' },
      }),
      secretDetail({
        name: 'rotated',
        namespace: 'default',
        creationTimestamp: new Date(NOW - 200 * DAY_MS).toISOString(),
        annotations: { 'secretops.vow.io/last-rotated': new Date(NOW - 10 * DAY_MS).toISOString() },
      }),
    ];
    cluster.eso = {
      installed: true,
      externalSecretCount: 2,
      readyExternalSecretCount: 2,
      storeReady: true,
    };
    return cluster;
  }

  it('finds real leaks and never flags referenced values', async () => {
    const report = await auditSecretsAndLeaks({ cluster: auditCluster(), now: () => NOW });
    assert.equal(report.leaksDetected.length, 6);
    const byType = new Map(report.leaksDetected.map((l) => [`${l.targetType}:${l.key}`, l]));
    assert.equal(byType.get('POD_ENV:SSH_KEY')?.detectedType, 'PRIVATE_KEY');
    assert.equal(byType.get('POD_ENV:SSH_KEY')?.severity, 'CRITICAL');
    assert.equal(byType.get('POD_ENV:AWS_ACCESS_KEY_ID')?.detectedType, 'AWS_KEY');
    assert.equal(byType.get('POD_ENV:DB_PASSWORD')?.detectedType, 'DATABASE_PASSWORD');
    assert.equal(byType.get('CONTAINER_ARG:--github-token')?.detectedType, 'GITHUB_TOKEN');
    assert.equal(byType.get('POD_ENV:HIGH_ENTROPY_KEY')?.detectedType, 'GENERIC_HIGH_ENTROPY');
    assert.equal(byType.get('CONFIGMAP:REDIS_ADMIN_PASSWORD')?.detectedType, 'DATABASE_PASSWORD');
    // Referenced values and plain values are not findings.
    assert.equal(byType.has('POD_ENV:API_TOKEN'), false);
    assert.equal(byType.has('POD_ENV:NORMAL_VAR'), false);
    assert.equal(byType.has('CONFIGMAP:PLAIN'), false);
  });

  it('never includes a raw credential value in the report', async () => {
    const report = await auditSecretsAndLeaks({ cluster: auditCluster(), now: () => NOW });
    const serialized = JSON.stringify(report);
    for (const planted of [
      'AKIAIOSFODNN7EXAMPLE',
      's3cr3t-db-value',
      'redis-secret-value',
      `ghp_${'a'.repeat(36)}`,
      'xK9mQ2vL8pR4tY6wN3bV7cD1fH5jK9m',
      'MIIEowIBAAKCAQEA7fixture',
    ]) {
      assert.equal(serialized.includes(planted), false, `report leaks ${planted}`);
    }
    // Masked values show only the head and tail.
    const aws = report.leaksDetected.find((l) => l.key === 'AWS_ACCESS_KEY_ID');
    assert.equal(aws?.maskedValue, 'AKIA...MPLE');
  });

  it('derives hygiene from real metadata', async () => {
    const report = await auditSecretsAndLeaks({ cluster: auditCluster(), now: () => NOW });
    assert.equal(report.totalSecrets, 5);
    assert.equal(report.staleSecretCount, 1);
    assert.equal(report.externalVaultConnected, true);
    const byName = new Map(report.hygieneRecords.map((h) => [h.secretName, h]));
    assert.equal(byName.get('db-creds')?.ageDays, 124);
    assert.equal(byName.get('db-creds')?.status, 'EXPIRED_ROTATION_NEEDED');
    assert.equal(byName.get('db-creds')?.managedBy, 'Manual');
    assert.equal(byName.get('tls-cert')?.managedBy, 'cert-manager');
    assert.equal(byName.get('tls-cert')?.status, 'HEALTHY');
    assert.equal(byName.get('eso-secret')?.managedBy, 'ESO / Vault');
    assert.equal(byName.get('argo-secret')?.managedBy, 'ArgoCD');
    // The rotation annotation, not creation, sets the age.
    assert.equal(byName.get('rotated')?.ageDays, 10);
    assert.equal(byName.get('rotated')?.status, 'HEALTHY');
    assert.equal(
      byName.get('rotated')?.lastRotated,
      new Date(NOW - 10 * DAY_MS).toISOString()
    );
  });

  it('reports an empty cluster honestly', async () => {
    const report = await auditSecretsAndLeaks({ cluster: new FakeCluster(), now: () => NOW });
    assert.equal(report.totalSecrets, 0);
    assert.equal(report.leaksDetected.length, 0);
    assert.equal(report.staleSecretCount, 0);
    assert.equal(report.externalVaultConnected, false);
  });

  it('throws ClusterUnavailableError with no cluster', async () => {
    const cluster = new FakeCluster();
    cluster.telemetry = offlineTelemetry();
    await assert.rejects(
      () => auditSecretsAndLeaks({ cluster, now: () => NOW }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });
});

describe('rotateSecretCredential', () => {
  const NEW_VALUE = 'N3wS3cr3tValue0123456789abcdef';

  function rotationCluster(): { cluster: FakeCluster; rsOwners: Map<string, string> } {
    const cluster = new FakeCluster();
    cluster.secrets = [
      secretDetail({
        name: 'db-creds',
        namespace: 'postgres',
        dataKeys: ['password', 'username'],
        data: { password: b64('old-password-value'), username: b64('dbuser') },
      }),
    ];
    cluster.pods = [
      podSpec({
        name: 'app-6d4f7b9c8d-x7k2p',
        namespace: 'postgres',
        ownerKind: 'ReplicaSet',
        ownerName: 'app-6d4f7b9c8d',
        containers: [
          {
            name: 'app',
            env: [
              {
                name: 'DB_PASSWORD',
                valueFromKind: 'secretKeyRef',
                valueFromName: 'db-creds',
                valueFromKey: 'password',
              },
            ],
            envFromSecrets: [],
            envFromConfigMaps: [],
            args: [],
          },
        ],
      }),
    ];
    return { cluster, rsOwners: new Map([['app-6d4f7b9c8d', 'app']]) };
  }

  it('patches via stdin, restarts the Deployment, verifies, and returns the real resourceVersion', async () => {
    const { cluster, rsOwners } = rotationCluster();
    const { run, calls } = makeRun(cluster, rsOwners);
    const result = await rotateSecretCredential('db-creds', 'postgres', {
      cluster,
      run,
      generateSecret: () => NEW_VALUE,
      now: () => NOW,
    });
    assert.equal(result.success, true);
    assert.equal(result.newVersion, '101');
    assert.match(result.message, /Rotated key 'password'/);
    assert.match(result.message, /Restarted and verified: deployment\/app/);

    const apply = calls.find((c) => c.args[0] === 'apply');
    assert.ok(apply, 'expected a kubectl apply call');
    assert.deepEqual(apply.args, ['apply', '-f', '-']);
    const manifest = JSON.parse(apply.input ?? '') as {
      data: Record<string, string>;
      metadata: { annotations: Record<string, string> };
    };
    assert.equal(manifest.data.password, b64(NEW_VALUE));
    assert.equal(manifest.data.username, b64('dbuser'));
    assert.equal(
      manifest.metadata.annotations['secretops.vow.io/last-rotated'],
      new Date(NOW).toISOString()
    );
    // The new value appears nowhere in argv — only in the stdin manifest.
    const allArgs = calls.flatMap((c) => c.args).join(' ');
    assert.equal(allArgs.includes(NEW_VALUE), false);
    assert.equal(allArgs.includes(b64(NEW_VALUE)), false);

    assert.ok(
      calls.some((c) => c.args.join(' ') === 'get replicaset app-6d4f7b9c8d -n postgres -o json')
    );
    assert.ok(
      calls.some((c) => c.args.join(' ') === 'rollout restart deployment/app -n postgres')
    );
    assert.ok(
      calls.some(
        (c) => c.args.join(' ') === 'rollout status deployment/app -n postgres --timeout=120s'
      )
    );
  });

  it('returns not_found for an unknown secret without running anything', async () => {
    const { cluster, rsOwners } = rotationCluster();
    const { run, calls } = makeRun(cluster, rsOwners);
    const result = await rotateSecretCredential('missing', 'postgres', { cluster, run });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'not_found');
    assert.equal(calls.length, 0);
  });

  it('refuses immutable, structured-type, and keyless secrets', async () => {
    const cluster = new FakeCluster();
    cluster.secrets = [
      secretDetail({ name: 'locked', namespace: 'default', immutable: true }),
      secretDetail({ name: 'tls', namespace: 'default', type: 'kubernetes.io/tls', dataKeys: ['tls.crt', 'tls.key'] }),
      secretDetail({ name: 'empty', namespace: 'default', dataKeys: [], data: {} }),
    ];
    const { run, calls } = makeRun(cluster, new Map());
    for (const name of ['locked', 'tls', 'empty']) {
      const result = await rotateSecretCredential(name, 'default', { cluster, run });
      assert.equal(result.success, false, name);
      assert.equal(result.reason, 'not_rotatable', name);
    }
    assert.equal(calls.length, 0);
  });

  it('throws when the rollout status fails (no false success)', async () => {
    const { cluster, rsOwners } = rotationCluster();
    const { run } = makeRun(cluster, rsOwners, (_cmd, args) =>
      args[0] === 'rollout' && args[1] === 'status' ? 'deployment "app" not ready' : null
    );
    await assert.rejects(
      () =>
        rotateSecretCredential('db-creds', 'postgres', {
          cluster,
          run,
          generateSecret: () => NEW_VALUE,
          now: () => NOW,
        }),
      /rollout status/
    );
  });

  it('throws when the apply fails', async () => {
    const { cluster, rsOwners } = rotationCluster();
    const { run } = makeRun(cluster, rsOwners, (_cmd, args) =>
      args[0] === 'apply' ? 'connection refused' : null
    );
    await assert.rejects(
      () =>
        rotateSecretCredential('db-creds', 'postgres', {
          cluster,
          run,
          generateSecret: () => NEW_VALUE,
          now: () => NOW,
        }),
      /kubectl apply/
    );
  });

  it('succeeds with no dependent workloads and warns for ArgoCD-managed secrets', async () => {
    const cluster = new FakeCluster();
    cluster.secrets = [
      secretDetail({
        name: 'solo',
        namespace: 'default',
        labels: { 'app.kubernetes.io/managed-by': 'argocd' },
      }),
    ];
    const { run, calls } = makeRun(cluster, new Map());
    const result = await rotateSecretCredential('solo', 'default', {
      cluster,
      run,
      generateSecret: () => NEW_VALUE,
      now: () => NOW,
    });
    assert.equal(result.success, true);
    assert.match(result.message, /No dependent workloads/);
    assert.match(result.message, /ArgoCD/);
    assert.equal(calls.some((c) => c.args[0] === 'rollout'), false);
  });

  it('reports un-restartable owners as manual steps instead of failing', async () => {
    const { cluster, rsOwners } = rotationCluster();
    cluster.pods.push(
      podSpec({
        name: 'nightly-abc',
        namespace: 'postgres',
        ownerKind: 'CronJob',
        ownerName: 'nightly',
        containers: [
          {
            name: 'job',
            env: [
              {
                name: 'DB_PASSWORD',
                valueFromKind: 'secretKeyRef',
                valueFromName: 'db-creds',
                valueFromKey: 'password',
              },
            ],
            envFromSecrets: [],
            envFromConfigMaps: [],
            args: [],
          },
        ],
      })
    );
    const { run } = makeRun(cluster, rsOwners);
    const result = await rotateSecretCredential('db-creds', 'postgres', {
      cluster,
      run,
      generateSecret: () => NEW_VALUE,
      now: () => NOW,
    });
    assert.equal(result.success, true);
    assert.match(result.message, /Not restarted: cronjob postgres\/nightly/);
  });

  it('throws ClusterUnavailableError with no cluster', async () => {
    const { cluster, rsOwners } = rotationCluster();
    cluster.telemetry = offlineTelemetry();
    const { run } = makeRun(cluster, rsOwners);
    await assert.rejects(
      () => rotateSecretCredential('db-creds', 'postgres', { cluster, run }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });
});
