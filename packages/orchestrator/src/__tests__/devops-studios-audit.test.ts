import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  evaluateManifest,
  lintDdlScript,
  deployWasmMicroservice,
  generateSealedSecretManifest,
  rotateSecretCredential,
  enforceStrictMtls,
  calculateBurnRates,
  compareSnapshotWithLive,
  generatePostmortem,
  executeSyntheticLoad,
  ProfileManager,
  scaffoldCustomApp,
  deleteCustomApp,
  ArgoManager,
  FluxManager,
  getHelmReleaseValues,
  uninstallLocalChart,
  executePostgresQuery,
  runStorageBenchmark,
  ContainerExecSession,
  WaffleSourceManager,
  listRollouts,
  setCanaryWeight,
  promoteRollout,
  abortRollout,
  scaffoldZeroTrustPolicy,
  createVeleroBackup,
  restoreVeleroBackup,
  createDockerNodeSnapshot,
  drainK3sNodeLive,
  cordonK3sNodeLive,
  drainK3sNode,
  generateK3sOneLiner,
  generateK3sJoinScript,
  ensureDevCertificate,
  executeCopilotTool,
  deepMerge,
  scaleK3dNodes,
  generateCoreDnsConfig,
  fetchClusterTraces,
  injectNetworkLatency,
} from '../index.js';

describe('DevOps Studios Bug Hunt & Security Audit', () => {
  describe('Admission Guard (:latest & untagged image detection)', () => {
    it('rejects explicit :latest image tags', async () => {
      const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  template:
    spec:
      containers:
      - name: test
        image: nginx:latest
`;
      const res = await evaluateManifest(yaml);
      const rule = res.findings.find((f) => f.ruleId === 'disallow-latest-image-tag');
      assert.ok(rule);
      assert.equal(rule.passed, false);
      assert.match(rule.message, /REJECTED/);
    });

    it('rejects untagged image references (implied latest)', async () => {
      const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  template:
    spec:
      containers:
      - name: test
        image: redis
`;
      const res = await evaluateManifest(yaml);
      const rule = res.findings.find((f) => f.ruleId === 'disallow-latest-image-tag');
      assert.ok(rule);
      assert.equal(rule.passed, false, 'Untagged image "redis" should fail the :latest rule');
    });

    it('passes explicit pinned semantic versions', async () => {
      const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-app
spec:
  template:
    spec:
      containers:
      - name: test
        image: redis:7.2.4-alpine
`;
      const res = await evaluateManifest(yaml);
      const rule = res.findings.find((f) => f.ruleId === 'disallow-latest-image-tag');
      assert.ok(rule);
      assert.equal(rule.passed, true);
    });
  });

  describe('Database Migration DDL Linter (CREATE UNIQUE INDEX)', () => {
    it('detects un-concurrent CREATE INDEX', async () => {
      const sql = 'CREATE INDEX idx_users_email ON users (email);';
      const result = await lintDdlScript(sql);
      assert.equal(result.clean, false);
      assert.equal(result.findings[0]?.rule, 'require-concurrent-index-creation');
    });

    it('detects un-concurrent CREATE UNIQUE INDEX', async () => {
      const sql = 'CREATE UNIQUE INDEX idx_users_email ON users (email);';
      const result = await lintDdlScript(sql);
      assert.equal(result.clean, false, 'CREATE UNIQUE INDEX without CONCURRENTLY must be flagged');
      assert.equal(result.findings[0]?.rule, 'require-concurrent-index-creation');
      assert.match(result.findings[0]?.suggestedFix || '', /CREATE UNIQUE INDEX CONCURRENTLY/);
    });

    it('passes CREATE UNIQUE INDEX CONCURRENTLY', async () => {
      const sql = 'CREATE UNIQUE INDEX CONCURRENTLY idx_users_email ON users (email);';
      const result = await lintDdlScript(sql);
      assert.equal(result.clean, true);
    });
  });

  describe('WASM Microservice Deployer (Input validation)', () => {
    it('rejects namespace with newlines or invalid characters', async () => {
      await assert.rejects(
        () => deployWasmMicroservice('wasm-rust-kv', 'default\n  injected: true'),
        /Invalid namespace/
      );
    });

    it('returns failure when serviceId is not found', async () => {
      const res = await deployWasmMicroservice('nonexistent-service', 'default');
      assert.equal(res.success, false);
      assert.match(res.message, /not found in catalog/);
    });

    it('deploys valid microservice in valid namespace', async () => {
      const res = await deployWasmMicroservice('wasm-rust-kv', 'prod');
      assert.equal(res.success, true);
      assert.match(res.manifest, /namespace: prod/);
    });
  });

  describe('SecretOps (Input validation & injection prevention)', () => {
    it('rejects invalid namespace or secretName in sealed secret generation', () => {
      assert.throws(
        () => generateSealedSecretManifest('bad secret name!', 'default', { key: 'val' }),
        /Invalid secret name/
      );
      assert.throws(
        () => generateSealedSecretManifest('valid-secret', 'bad\nnamespace', { key: 'val' }),
        /Invalid namespace/
      );
    });

    it('rejects keys containing invalid YAML or control characters', () => {
      assert.throws(
        () => generateSealedSecretManifest('valid-secret', 'default', { 'bad:key\n': 'val' }),
        /Invalid secret key/
      );
    });

    it('generates valid SealedSecret manifest for valid inputs', () => {
      const manifest = generateSealedSecretManifest('app-secrets', 'production', {
        api_token: 'secret123',
      });
      assert.match(manifest, /name: app-secrets/);
      assert.match(manifest, /namespace: production/);
      assert.match(manifest, /api_token:/);
    });

    it('rejects invalid names in credential rotation', async () => {
      await assert.rejects(
        () => rotateSecretCredential('bad name with spaces', 'default'),
        /Invalid secret name/
      );
    });
  });

  describe('Service Mesh (Namespace validation)', () => {
    it('rejects invalid namespace in enforceStrictMtls', async () => {
      await assert.rejects(
        () => enforceStrictMtls('default\n  injected: true'),
        /Invalid namespace/
      );
    });

    it('succeeds for valid namespace', async () => {
      const res = await enforceStrictMtls('nextcloud');
      assert.equal(res.success, true);
      assert.match(res.manifest, /name: strict-mtls-nextcloud/);
    });
  });

  describe('SLO Burn Rates (Not-found handling)', () => {
    it('returns null for unknown serviceId', async () => {
      const res = await calculateBurnRates('unknown-service-xyz');
      assert.equal(res, null);
    });

    it('returns telemetry for valid serviceId', async () => {
      const res = await calculateBurnRates('slo-keycloak');
      assert.ok(res);
      assert.equal(res.serviceId, 'slo-keycloak');
    });
  });

  describe('Rewind Snapshots (Not-found handling)', () => {
    it('returns null for unknown snapshotId', async () => {
      const res = await compareSnapshotWithLive('unknown-snap-xyz');
      assert.equal(res, null);
    });

    it('returns comparison for valid snapshotId', async () => {
      const res = await compareSnapshotWithLive('snap-2026-09-28-1800');
      assert.ok(res);
      assert.equal(res.snapshotId, 'snap-2026-09-28-1800');
    });
  });

  describe('Postmortem Generator (Safety with undefined workloads)', () => {
    it('handles undefined or empty workloads array safely', async () => {
      const res = await generatePostmortem({
        incidentTitle: 'Test Incident',
        affectedWorkloads: [],
        severity: 'SEV-2',
      });
      assert.ok(res);
      assert.ok(res.fullReportMarkdown.includes('Test Incident'));
    });
  });

  describe('KEDA Synthetic Load (Workload validation)', () => {
    it('throws error for non-existent workload', async () => {
      await assert.rejects(
        () =>
          executeSyntheticLoad({
            targetWorkload: 'non-existent-workload-xyz',
            virtualUsers: 10,
            durationSeconds: 5,
            targetRps: 100,
            pattern: 'SPIKE',
          }),
        /ScaledObject for workload 'non-existent-workload-xyz' not found/
      );
    });
  });

  describe('Deep-Dive Path Traversal & Injection Hardening', () => {
    it('ProfileManager.importProfile rejects path traversal and non-yaml overrides atomically', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-profile-test-'));
      try {
        const pm = new ProfileManager(tmp);
        assert.throws(
          () =>
            pm.importProfile({
              name: 'evil',
              version: '1.0.0',
              timestamp: new Date().toISOString(),
              cluster: {},
              enablers: { GRAFANA_ENABLED: true },
              argoOverrides: {
                '../../pwned.yaml': 'evil: true',
              },
            }),
          /Path traversal rejected/
        );
        assert.equal(fs.existsSync(path.join(tmp, '.env.enabler')), false, 'Should fail before writing .env.enabler');

        assert.throws(
          () =>
            pm.importProfile({
              name: 'evil-ext',
              version: '1.0.0',
              timestamp: new Date().toISOString(),
              cluster: {},
              enablers: {},
              argoOverrides: {
                'grafana/evil.sh': '#!/bin/sh\nid',
              },
            }),
          /must be a relative \.yaml\/\.yml path/
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('scaffoldCustomApp & deleteCustomApp prevent path traversal, built-in deletion, and YAML injection', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-scaffold-test-'));
      fs.mkdirSync(path.join(tmp, 'argo', 'argocd'), { recursive: true });
      try {
        assert.throws(() => deleteCustomApp('..', tmp), /Invalid application id/);
        assert.throws(() => deleteCustomApp('../etc', tmp), /Invalid application id/);
        assert.throws(() => deleteCustomApp('argocd', tmp), /Cannot delete built-in application/);
        assert.ok(fs.existsSync(path.join(tmp, 'argo', 'argocd')), 'Built-in argo/argocd must remain intact');

        assert.throws(
          () =>
            scaffoldCustomApp(
              {
                id: 'my-custom-app',
                name: 'My App',
                category: 'Custom & Local Charts',
                description: 'Test',
                sourceType: 'helm',
                repoURL: "https://example.com/charts'\n    injected: true",
              },
              tmp
            ),
          /Invalid repoURL/
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('ArgoManager, FluxManager, and Helm helpers reject invalid K8s names and path traversals', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-gitops-test-'));
      try {
        const argo = new ArgoManager(tmp);
        assert.throws(() => argo.prepareAppManifest('../../etc/passwd'), /Invalid application name/);
        assert.throws(() => argo.syncApp('--server=evil'), /Invalid application name/);

        const flux = new FluxManager(tmp);
        assert.throws(() => flux.prepareAppManifest('../secret'), /Invalid application name/);
        assert.throws(() => flux.syncApp('my-app', '--kubeconfig=/tmp/evil'), /Invalid namespace/);

        await assert.rejects(
          () => getHelmReleaseValues('--kubeconfig=/etc/passwd', 'default'),
          /Invalid release name/
        );
        assert.throws(
          () => uninstallLocalChart(tmp, '--flag-inject', 'default'),
          /Invalid release name/
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('executePostgresQuery blocks comment/multi-statement destructive SQL and validates db/user', async () => {
      await assert.rejects(
        () => executePostgresQuery('/* bypass */ DROP TABLE users;'),
        /Destructive operations/
      );
      await assert.rejects(
        () => executePostgresQuery('SELECT 1; DELETE FROM users;'),
        /Destructive operations/
      );
      await assert.rejects(
        () => executePostgresQuery('WITH d AS (TRUNCATE users) SELECT * FROM d;'),
        /Destructive operations/
      );
      await assert.rejects(
        () => executePostgresQuery('ALTER TABLE users DROP COLUMN password;'),
        /Destructive operations/
      );
      await assert.rejects(
        () => executePostgresQuery('SELECT 1;', { database: '--command=\\!id' }),
        /Invalid database name/
      );
      await assert.rejects(
        () => executePostgresQuery('SELECT 1;', { user: '-f/etc/passwd' }),
        /Invalid database user/
      );
    });

    it('runStorageBenchmark validates storageClass and sizeGi before YAML construction', async () => {
      await assert.rejects(
        () => runStorageBenchmark(process.cwd(), 'local-path\n   evil: true', 1),
        /Invalid storageClass/
      );
      await assert.rejects(
        () => runStorageBenchmark(process.cwd(), 'local-path', -5),
        /Invalid benchmark volume sizeGi/
      );
    });

    it('ContainerExecSession rejects flag injection in podName, namespace, and containerName', () => {
      const badPod = new ContainerExecSession({
        namespace: 'default',
        podName: '--kubeconfig=/tmp/pwn',
      });
      assert.throws(() => badPod.start(), /Invalid pod name/);

      const badNs = new ContainerExecSession({
        namespace: '--server=https://evil',
        podName: 'my-pod',
      });
      assert.throws(() => badNs.start(), /Invalid namespace/);
    });

    it('WaffleSourceManager.addSource rejects git option smuggling', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-sources-test-'));
      try {
        const mgr = new WaffleSourceManager(tmp);
        await assert.rejects(
          () => mgr.addSource({ type: 'git', pathOrUrl: '--upload-pack=touch /tmp/pwn' }),
          /Invalid git repository URL/
        );
        await assert.rejects(
          () => mgr.addSource({ type: 'git', pathOrUrl: 'ext::sh -c id' }),
          /Invalid git repository URL/
        );
        await assert.rejects(
          () => mgr.addSource({ type: 'git', pathOrUrl: 'https://example.com/repo.git', branch: '--config=evil' }),
          /Invalid git branch/
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('Rollouts, NetPol, Backup, TLS, Copilot, and K3s Join validate inputs and prevent flag/command injection', async () => {
      await assert.rejects(() => listRollouts('--server=evil'), /Invalid namespace/);
      await assert.rejects(() => setCanaryWeight('--bad-name', 'default', 50), /Invalid rollout name/);
      await assert.rejects(() => promoteRollout('app', '--bad-ns'), /Invalid namespace/);
      await assert.rejects(() => abortRollout('--bad', 'default'), /Invalid rollout name/);

      const weightRes = await setCanaryWeight('valid-app', 'default', Number.NaN);
      assert.equal(weightRes.weight, 0);

      assert.throws(
        () => scaffoldZeroTrustPolicy('bad\napp', 'default', []),
        /Invalid appId/
      );
      const netpolYaml = scaffoldZeroTrustPolicy('api-svc', 'prod', ['frontend']);
      assert.match(netpolYaml, /- from:\n\s+- namespaceSelector:/);

      assert.throws(() => createVeleroBackup('---', ['default']), /Invalid backup name/);
      assert.throws(() => createVeleroBackup('valid-backup', ['--bad-ns']), /Invalid namespace/);
      assert.throws(() => restoreVeleroBackup('--from-schedule=x'), /Invalid backup name/);
      await assert.rejects(() => createDockerNodeSnapshot('--help', 'snap1'), /Invalid container name/);

      await assert.rejects(() => drainK3sNodeLive(process.cwd(), '--force'), /Invalid node name/);
      await assert.rejects(() => cordonK3sNodeLive(process.cwd(), '--kubeconfig=/etc/passwd'), /Invalid node name/);
      assert.throws(() => drainK3sNode(process.cwd(), '--help'), /Invalid node name/);

      assert.throws(
        () => generateK3sOneLiner({ serverUrl: 'https://127.0.0.1:6443"; id; #' }),
        /Invalid serverUrl/
      );
      assert.throws(
        () => generateK3sJoinScript({ nodeName: 'node-1; touch /tmp/pwn' }),
        /Invalid nodeName/
      );

      await assert.rejects(
        () => ensureDevCertificate(process.cwd(), { hostnames: ['-uninstall'] }),
        /Invalid certificate hostname/
      );

      await assert.rejects(
        () => executeCopilotTool(process.cwd(), 'kubectl_describe_pod', { podName: '--kubeconfig=/etc/passwd' }),
        /Invalid pod name/
      );
      await assert.rejects(
        () => executeCopilotTool(process.cwd(), 'kubectl_restart_rollout', { resourceType: 'clusterrole', resourceName: 'admin' }),
        /Invalid resourceType/
      );

      await assert.rejects(
        () => injectNetworkLatency('default', '--invalid-pod'),
        /Invalid pod name/
      );
    });

    it('deepMerge prevents prototype pollution and Object.prototype property collisions', () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}, "toString": "overridden"}');
      const merged = deepMerge({ safe: 1 }, malicious) as Record<string, unknown>;
      assert.equal(({} as Record<string, unknown>).polluted, undefined);
      assert.equal(merged.safe, 1);
      assert.equal(merged.toString, 'overridden');
    });

    it('scaleK3dNodes, generateCoreDnsConfig, and fetchClusterTraces handle edge cases accurately', async () => {
      const badScale = await scaleK3dNodes('my-cluster', -2);
      assert.equal(badScale.success, false);
      assert.match(badScale.message, /Invalid targetAgentCount/);

      const corefile = generateCoreDnsConfig('sub.cluster.local', '10.0.0.1');
      assert.ok(corefile.includes('match .*\\.sub\\.cluster\\.local'));

      const traces = await fetchClusterTraces();
      for (const t of traces) {
        assert.equal(t.spansCount, t.spans.length, `Trace ${t.traceId} spansCount must match spans.length`);
      }
    });
  });
});
