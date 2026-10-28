import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
});
