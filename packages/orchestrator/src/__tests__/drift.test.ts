import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  scanClusterDrift,
  reconcileClusterFromGit,
  generateReverseCommitPatch,
  type DriftDeps,
} from '../drift.js';
import { type ClusterTelemetry } from '../k8s.js';
import { ClusterUnavailableError } from '../errors.js';
import { validateCommand } from '../executor.js';
import type { CommandWaitResult } from '../executor.js';

/**
 * Batch C wiring, Phase 1: drift wired to real systems.
 *
 * The cluster and the commands are stubbed through the deps seam; the
 * project root is a real fixture on disk (argo manifests + desired
 * manifests), because manifest resolution is filesystem work. No test
 * asserts on fabricated values: every expected number comes from the
 * fixture desired state and the stubbed live state.
 */

const LIVE_DEPLOYMENT = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: {
    name: 'nextcloud',
    namespace: 'nextcloud',
    uid: 'live-uid',
    resourceVersion: '99',
    creationTimestamp: '2026-11-12T00:00:00Z',
  },
  spec: {
    replicas: 3,
    template: {
      spec: {
        containers: [{ name: 'nextcloud', image: 'nextcloud:27.1-apache' }],
      },
    },
  },
  status: { replicas: 3 },
};

const LIVE_HELM_DEPLOYMENT = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  // Helm applies the rendered manifest as-is, so the live object carries
  // the labels the chart renders (unlike the plain-YAML Deployment above,
  // whose manifest declares no labels).
  metadata: {
    name: 'nextcloud-web',
    namespace: 'nextcloud',
    uid: 'helm-uid',
    labels: { app: 'nextcloud-web' },
  },
  spec: {
    replicas: 1,
    template: {
      spec: {
        containers: [{ name: 'web', image: 'nextcloud:27.1-apache' }],
      },
    },
  },
};

const HELM_TEMPLATE_OUTPUT = `---
# Source: nextcloud/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nextcloud-web
  labels:
    app: nextcloud-web
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: web
          image: nextcloud:27.1-apache
`;

const TELEMETRY_ONLINE: ClusterTelemetry = {
  isConnected: true,
  context: 'test-context',
  detectedPlatform: 'k3d',
  detectedClusterName: 'test-cluster',
  nodeCount: 1,
  podCount: 2,
  namespaceCount: 1,
  ingressCount: 0,
  nodes: [],
  namespaces: ['nextcloud'],
  ingresses: [],
  // Fleet slice extended ClusterTelemetry; drift never reads these.
  k8sVersion: 'v1.31.2',
  cpuCapacityCores: 8,
  memoryCapacityGb: 16,
  server: 'https://127.0.0.1:6443',
};

const TELEMETRY_OFFLINE: ClusterTelemetry = { ...TELEMETRY_ONLINE, isConnected: false };

function telemetry(overrides: Partial<ClusterTelemetry> = {}): ClusterTelemetry {
  return { ...TELEMETRY_ONLINE, ...overrides };
}

function result(code: number, stdout = '', stderr = ''): CommandWaitResult {
  return { code, status: code === 0 ? 'completed' : 'failed', logs: [], stdout, stderr, taskId: 'test' };
}

let fixtureRoot = '';

function write(rel: string, content: string): void {
  const full = path.join(fixtureRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

before(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-drift-test-'));
  write(
    'src/default.env',
    [
      ': "${THIS_NAMESPACE:=nextcloud}"',
      ': "${THIS_REPO_URL:=https://example.invalid/repo.git}"',
      ': "${THIS_CD_RUNNER:=argocd}"',
      ': "${THIS_DOMAIN:=example.invalid}"',
      '',
    ].join('\n')
  );
  // Plain-YAML app: dir name == live app name (fast path).
  write(
    'argo/nextcloud/argocd.yaml',
    [
      'apiVersion: argoproj.io/v1alpha1',
      'kind: Application',
      'metadata:',
      '  name: nextcloud',
      '  namespace: argocd',
      'spec:',
      '  destination:',
      '    namespace: ${THIS_NAMESPACE}',
      '    server: https://kubernetes.default.svc',
      '  project: default',
      '  source:',
      '    path: manifests/nextcloud',
      '    repoURL: ${THIS_REPO_URL}',
      '    targetRevision: HEAD',
      '',
    ].join('\n')
  );
  write(
    'manifests/nextcloud/deployment.yaml',
    [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: nextcloud',
      '  namespace: nextcloud',
      'spec:',
      '  replicas: 1',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: nextcloud',
      '          image: nextcloud:27.1-apache',
      '',
    ].join('\n')
  );
  // Helm app: dir name differs from the live app name (slow path — the
  // match is by source.path, not by name: dir `nextcloud-chart`, live
  // name `examplenc`, CR name `examplenc`, path `charts/nextcloud`).
  write(
    'argo/nextcloud-chart/argocd.yaml',
    [
      'apiVersion: argoproj.io/v1alpha1',
      'kind: Application',
      'metadata:',
      '  name: examplenc',
      '  namespace: argocd',
      'spec:',
      '  destination:',
      '    namespace: ${THIS_NAMESPACE}',
      '    server: https://kubernetes.default.svc',
      '  project: default',
      '  source:',
      '    path: charts/nextcloud',
      '    repoURL: ${THIS_REPO_URL}',
      '    targetRevision: HEAD',
      '',
    ].join('\n')
  );
  write(
    'charts/nextcloud/Chart.yaml',
    ['apiVersion: v2', 'name: nextcloud', 'version: 1.0.0', ''].join('\n')
  );
  write(
    'charts/nextcloud/templates/deployment.yaml',
    [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: nextcloud-web',
      'spec:',
      '  replicas: 1',
      '  template:',
      '    spec:',
      '      containers:',
      '        - name: web',
      '          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}',
      '',
    ].join('\n')
  );
});

after(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

function liveApps() {
  return {
    installed: true,
    applications: [
      {
        name: 'nextcloud',
        namespace: 'argocd',
        healthStatus: 'Healthy' as const,
        syncStatus: 'Synced' as const,
        targetPath: 'manifests/nextcloud',
        destinationNamespace: 'nextcloud',
      },
      {
        name: 'examplenc',
        namespace: 'argocd',
        healthStatus: 'Healthy' as const,
        syncStatus: 'Synced' as const,
        targetPath: 'charts/nextcloud',
        destinationNamespace: 'nextcloud',
      },
    ],
  };
}

/** Stubbed command layer: records every call, answers kubectl/helm/git. */
function stubRunCommand(opts: { notFoundNames?: string[]; forbidden?: boolean } = {}) {
  const calls: { command: string; args: string[] }[] = [];
  const run = async (
    command: string,
    args: string[],
  ): Promise<CommandWaitResult> => {
    calls.push({ command, args });
    const joined = args.join(' ');
    if (command === 'kubectl' && args[0] === 'get' && args[1] === 'deployment') {
      const name = args[2];
      if (opts.notFoundNames?.includes(name)) {
        return result(1, '', `Error from server (NotFound): deployments.apps "${name}" not found`);
      }
      if (opts.forbidden) {
        return result(1, '', 'Error from server (Forbidden): deployments.apps is forbidden');
      }
      if (name === 'nextcloud') return result(0, JSON.stringify(LIVE_DEPLOYMENT));
      if (name === 'nextcloud-web') return result(0, JSON.stringify(LIVE_HELM_DEPLOYMENT));
      return result(1, '', `Error from server (NotFound): deployments.apps "${name}" not found`);
    }
    if (command === 'kubectl' && args[0] === 'get' && args[1] === 'all') {
      return result(
        0,
        JSON.stringify({
          items: [
            LIVE_DEPLOYMENT,
            LIVE_HELM_DEPLOYMENT,
            {
              apiVersion: 'v1',
              kind: 'Service',
              metadata: { name: 'rogue-svc', namespace: 'nextcloud' },
              spec: { ports: [{ port: 80 }] },
            },
            {
              apiVersion: 'v1',
              kind: 'Pod',
              metadata: {
                name: 'nextcloud-abc123',
                namespace: 'nextcloud',
                ownerReferences: [{ name: 'nextcloud-xyz', kind: 'ReplicaSet' }],
              },
              spec: { containers: [{ name: 'nextcloud', image: 'nextcloud:27.1-apache' }] },
            },
          ],
        })
      );
    }
    if (command === 'helm' && args[0] === 'template') {
      return result(0, HELM_TEMPLATE_OUTPUT);
    }
    if (command === 'git' && args[0] === 'rev-parse') {
      return result(0, '0123456789abcdef0123456789abcdef01234567\n');
    }
    throw new Error(`unexpected stubbed command: ${command} ${joined}`);
  };
  return { calls, run };
}

function baseDeps(overrides: Partial<DriftDeps> = {}): DriftDeps {
  const stub = stubRunCommand();
  return {
    projectRoot: fixtureRoot,
    k8sClient: {
      getTelemetry: async () => telemetry(),
      getArgoApplications: async () => liveApps(),
    },
    runCommand: stub.run as DriftDeps['runCommand'],
    ...overrides,
  };
}

describe('scanClusterDrift', () => {
  it('compares real git manifests against real live state (no seeded rows)', async () => {
    const report = await scanClusterDrift(baseDeps());
    // Desired: nextcloud Deployment (replicas 1) + helm nextcloud-web
    // (replicas 1). Live: nextcloud replicas 3 (drift), nextcloud-web
    // replicas 1 (in sync), plus an orphaned Service.
    assert.equal(report.totalScanned, 3);
    assert.equal(report.driftedCount, 2);
    assert.equal(report.inSyncCount, 1);
    assert.equal(report.complianceScore, 33);
    const replicaDrift = report.items.find((i) => i.driftType === 'REPLICA_COUNT_DRIFT');
    assert.ok(replicaDrift);
    assert.equal(replicaDrift.id, 'drift:nextcloud:deployment:nextcloud:nextcloud');
    assert.equal(replicaDrift.diffSummary, 'spec.replicas: Git (1) ≠ Cluster (3)');
    assert.equal(replicaDrift.gitFilePath, 'manifests/nextcloud/deployment.yaml');
    const orphan = report.items.find((i) => i.driftType === 'ORPHANED_RESOURCE');
    assert.ok(orphan);
    assert.equal(orphan.resourceName, 'rogue-svc');
  });

  it('resolves a Helm chart through the slow path (live name != dir name)', async () => {
    const stub = stubRunCommand();
    const report = await scanClusterDrift({
      projectRoot: fixtureRoot,
      k8sClient: {
        getTelemetry: async () => telemetry(),
        getArgoApplications: async () => ({
          installed: true,
          applications: [liveApps().applications[1]],
        }),
      },
      runCommand: stub.run as DriftDeps['runCommand'],
    });
    // The live app is `examplenc` but the local dir is `nextcloud-chart`
    // — the match is by source.path, not by name. Proof it resolved:
    // helm template ran, and the rendered Deployment matched live, so
    // it appears in NEITHER the drift items NOR the orphans. (The
    // partial scan does see the other app's Deployment as an orphan —
    // from this scan's perspective it is untracked — plus rogue-svc.)
    assert.ok(stub.calls.some((c) => c.command === 'helm' && c.args[0] === 'template'));
    assert.equal(report.items.find((i) => i.resourceName === 'nextcloud-web'), undefined);
    assert.deepEqual(
      report.items.map((i) => i.resourceName).sort(),
      ['nextcloud', 'rogue-svc']
    );
  });

  it('throws ClusterUnavailableError with no cluster (never an empty all-clear)', async () => {
    await assert.rejects(
      scanClusterDrift({
        projectRoot: fixtureRoot,
        k8sClient: {
          getTelemetry: async () => TELEMETRY_OFFLINE,
          getArgoApplications: async () => liveApps(),
        },
      }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });

  it('returns an empty report when ArgoCD is not installed', async () => {
    const report = await scanClusterDrift({
      projectRoot: fixtureRoot,
      k8sClient: {
        getTelemetry: async () => telemetry(),
        getArgoApplications: async () => ({ installed: false, applications: [] }),
      },
    });
    assert.deepEqual(report, {
      totalScanned: 0,
      inSyncCount: 0,
      driftedCount: 0,
      complianceScore: 100,
      items: [],
    });
  });

  it('reports a declared-but-missing resource (kubectl NotFound) as drift, not an error', async () => {
    // The stub's `get all` still lists nextcloud while its individual
    // get 404s (a delete/create race): the individual get is
    // authoritative, so the resource still reads as missing.
    const stub = stubRunCommand({ notFoundNames: ['nextcloud'] });
    const report = await scanClusterDrift({
      ...baseDeps(),
      runCommand: stub.run as DriftDeps['runCommand'],
    });
    const missing = report.items.find((i) => i.resourceName === 'nextcloud');
    assert.ok(missing);
    assert.equal(missing.liveContent, '# not present in cluster');
    assert.equal(missing.severity, 'HIGH');
  });

  it('surfaces a real kubectl failure instead of swallowing it', async () => {
    const stub = stubRunCommand({ forbidden: true });
    await assert.rejects(
      scanClusterDrift({ ...baseDeps(), runCommand: stub.run as DriftDeps['runCommand'] }),
      /Failed to read live state/
    );
  });
});

describe('reconcileClusterFromGit', () => {
  it('syncs the owning app for a known drift id and reports the real outcome', async () => {
    const syncCalls: { engine: string; appName: string; namespace: string }[] = [];
    const result = await reconcileClusterFromGit('drift:nextcloud:deployment:nextcloud:nextcloud', {
      ...baseDeps(),
      syncApp: async (engine, appName, namespace) => {
        syncCalls.push({ engine, appName, namespace });
        return { code: 0 };
      },
    });
    assert.equal(result.success, true);
    assert.deepEqual(syncCalls, [{ engine: 'argocd', appName: 'nextcloud', namespace: 'nextcloud' }]);
    assert.match(result.message, /ArgoCD sync requested for nextcloud/);
  });

  it('returns success:false for an unknown drift id (route maps it to 404)', async () => {
    const result = await reconcileClusterFromGit('drift:nope:deployment:default:nope', baseDeps());
    assert.equal(result.success, false);
    assert.match(result.message, /not found/);
  });

  it('returns success:false when the sync itself fails', async () => {
    const result = await reconcileClusterFromGit('drift:nextcloud:deployment:nextcloud:nextcloud', {
      ...baseDeps(),
      syncApp: async () => ({ code: 1 }),
    });
    assert.equal(result.success, false);
    assert.match(result.message, /exit code 1/);
  });

  it('refuses to reconcile an orphan (syncing cannot remove an untracked object)', async () => {
    let syncCalled = false;
    const result = await reconcileClusterFromGit('drift:nextcloud:service:nextcloud:rogue-svc', {
      ...baseDeps(),
      syncApp: async () => {
        syncCalled = true;
        return { code: 0 };
      },
    });
    assert.equal(result.success, false);
    assert.equal(syncCalled, false);
    assert.match(result.message, /cannot be reconciled by syncing/);
  });
});

describe('generateReverseCommitPatch', () => {
  it('returns a real patch, the real HEAD SHA, and applied:false', async () => {
    const result = await generateReverseCommitPatch(
      'drift:nextcloud:deployment:nextcloud:nextcloud',
      baseDeps()
    );
    assert.equal(result.success, true);
    assert.equal(result.applied, false);
    assert.equal(result.appliedResourceCount, 1);
    assert.equal(result.commitSha, '0123456789abcdef0123456789abcdef01234567');
    assert.match(result.patch, /^--- a\/manifests\/nextcloud\/deployment\.yaml$/m);
    assert.match(result.patch, /^- {2}replicas: 1$/m);
    assert.match(result.patch, /^\+ {2}replicas: 3$/m);
  });

  it('returns success:false for an unknown drift id (route maps it to 404)', async () => {
    const result = await generateReverseCommitPatch('drift:nope:deployment:default:nope', baseDeps());
    assert.equal(result.success, false);
    assert.equal(result.patch, '');
    assert.equal(result.commitSha, null);
    assert.equal(result.appliedResourceCount, 0);
  });
});

describe('drift command shapes pass the executor validator', () => {
  it('kubectl get, helm template, and git rev-parse are all allowlisted', () => {
    for (const [command, args] of [
      ['kubectl', ['get', 'deployment', 'nextcloud', '-n', 'nextcloud', '-o', 'json']],
      ['kubectl', ['get', 'all', '-n', 'nextcloud', '-o', 'json']],
      ['helm', ['template', 'examplenc', '/proj/charts/nextcloud', '--namespace', 'nextcloud']],
      ['git', ['rev-parse', 'HEAD']],
    ] as const) {
      const validation = validateCommand(command, [...args], fixtureRoot);
      assert.equal(validation.allowed, true, `${command} ${args.join(' ')}: ${validation.reason}`);
    }
  });
});
