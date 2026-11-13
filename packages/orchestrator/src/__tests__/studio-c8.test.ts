import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lintDdlScript } from '../migrate.js';
import { simulatePacketDropInspection } from '../ebpf.js';
import type { PodInfo } from '../k8s.js';
import type { NetworkPolicyReport, NetworkPolicyInfo } from '../netpol.js';

/** Batch C, C8: statement-level DDL linting and real NetworkPolicy evaluation. */

function makePod(name: string, namespace: string): PodInfo {
  return {
    name,
    namespace,
    status: 'Running',
    ready: '1/1',
    restarts: 0,
    node: 'node-1',
    ip: '10.0.0.1',
    age: '1d',
    containers: [{ name, image: 'app:1.0.0', ready: true, restartCount: 0 }],
  };
}

function makePolicy(
  overrides: Partial<NetworkPolicyInfo> & { name: string; namespace: string }
): NetworkPolicyInfo {
  return {
    policyTypes: ['Ingress'],
    podSelector: 'all pods',
    ingressRuleCount: 0,
    egressRuleCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeReport(policies: NetworkPolicyInfo[]): NetworkPolicyReport {
  return {
    totalPolicies: policies.length,
    coveredNamespaces: [...new Set(policies.map((p) => p.namespace))],
    unprotectedNamespaces: [],
    isolationScore: 50,
    policies,
    matrix: [],
  };
}

describe('lintDdlScript (C8)', () => {
  it('trips BLOCKER on a multi-line CREATE INDEX', async () => {
    const result = await lintDdlScript('CREATE\nINDEX idx_users_email ON users (email);');
    assert.equal(result.clean, false);
    const blocker = result.findings.find((f) => f.rule === 'require-concurrent-index-creation');
    assert.ok(blocker);
    assert.equal(blocker.severity, 'BLOCKER');
    assert.equal(blocker.line, 1);
  });

  it('does not fire on CREATE INDEX inside a line comment, block comment, or string literal', async () => {
    const commented = await lintDdlScript(
      '-- CREATE INDEX idx ON users (email);\nSELECT 1;'
    );
    assert.deepEqual(commented.findings, []);
    assert.equal(commented.clean, true);

    const blocked = await lintDdlScript('/* CREATE INDEX idx ON users (email); */\nSELECT 1;');
    assert.deepEqual(blocked.findings, []);
    assert.equal(blocked.clean, true);

    const nested = await lintDdlScript(
      '/* outer /* CREATE INDEX idx ON users (email); */ still a comment */\nSELECT 1;'
    );
    assert.deepEqual(nested.findings, []);

    const inString = await lintDdlScript(
      "INSERT INTO audit_log (note) VALUES ('CREATE INDEX idx ON users (email)');"
    );
    assert.deepEqual(inString.findings, []);
  });

  it('does not fire on CREATE INDEX inside a dollar-quoted function body', async () => {
    const result = await lintDdlScript(
      "DO $body$ BEGIN RAISE NOTICE 'CREATE INDEX idx ON users (email)'; END $body$;"
    );
    assert.deepEqual(result.findings, []);
  });

  it('reports the statement start line for a later statement', async () => {
    const sql = 'SELECT 1;\nSELECT 2;\nCREATE INDEX idx ON users (email);';
    const result = await lintDdlScript(sql);
    const blocker = result.findings.find((f) => f.rule === 'require-concurrent-index-creation');
    assert.ok(blocker);
    assert.equal(blocker.line, 3);
  });

  it('still flags multi-line DROP COLUMN as WARNING and volatile ADD COLUMN defaults as INFO', async () => {
    const drop = await lintDdlScript('ALTER TABLE users\nDROP COLUMN legacy_flag;');
    const warning = drop.findings.find((f) => f.rule === 'avoid-immediate-column-drop');
    assert.ok(warning);
    assert.equal(warning.severity, 'WARNING');
    assert.equal(warning.line, 1);

    const volatile = await lintDdlScript(
      'ALTER TABLE users ADD COLUMN score int DEFAULT random();'
    );
    const info = volatile.findings.find((f) => f.rule === 'verify-non-volatile-default');
    assert.ok(info);
    assert.equal(info.severity, 'INFO');

    const benign = await lintDdlScript(
      'ALTER TABLE users ADD COLUMN created_at timestamptz DEFAULT now();'
    );
    assert.deepEqual(benign.findings, []);
  });

  it('passes CREATE INDEX CONCURRENTLY', async () => {
    const result = await lintDdlScript('CREATE INDEX CONCURRENTLY idx ON users (email);');
    assert.deepEqual(result.findings, []);
    assert.equal(result.clean, true);
  });
});

describe('simulatePacketDropInspection (C8)', () => {
  const pods = [makePod('postgres-0', 'postgres'), makePod('api-1', 'default')];

  it('denies an unknown target pod with a not-found reason', async () => {
    const result = await simulatePacketDropInspection('api-1', 'ghost-0', 5432, {
      getPods: async () => pods,
      scanPolicies: async () => makeReport([]),
    });
    assert.equal(result.canConnect, false);
    assert.match(result.reason, /not found/);
    assert.equal(result.policyBlocking, undefined);
  });

  it('allows when no Ingress policy covers the target namespace (default-allow)', async () => {
    const result = await simulatePacketDropInspection('api-1', 'postgres-0', 5432, {
      getPods: async () => pods,
      scanPolicies: async () => makeReport([]),
    });
    assert.equal(result.canConnect, true);
    assert.match(result.reason, /default-allow/);
  });

  it('allows a postgres-named target when no policy covers it — the old substring heuristic is gone', async () => {
    const result = await simulatePacketDropInspection('api-1', 'postgres-0', 5432, {
      getPods: async () => pods,
      scanPolicies: async () =>
        makeReport([makePolicy({ name: 'other-ns-policy', namespace: 'other' })]),
    });
    assert.equal(result.canConnect, true);
  });

  it('denies when an all-pods policy with zero ingress rules covers the target namespace', async () => {
    const result = await simulatePacketDropInspection('api-1', 'postgres-0', 5432, {
      getPods: async () => pods,
      scanPolicies: async () =>
        makeReport([
          makePolicy({
            name: 'strict-ingress-netpol',
            namespace: 'postgres',
            podSelector: 'all pods',
            ingressRuleCount: 0,
          }),
        ]),
    });
    assert.equal(result.canConnect, false);
    assert.equal(result.policyBlocking, 'postgres/strict-ingress-netpol');
    assert.match(result.reason, /default-deny/);
  });

  it('denies fail-closed when a policy with ingress rules exists (source cannot be verified)', async () => {
    const result = await simulatePacketDropInspection('api-1', 'postgres-0', 5432, {
      getPods: async () => pods,
      scanPolicies: async () =>
        makeReport([
          makePolicy({
            name: 'postgres-allow-keycloak-only',
            namespace: 'postgres',
            podSelector: 'all pods',
            ingressRuleCount: 1,
          }),
        ]),
    });
    assert.equal(result.canConnect, false);
    assert.equal(result.policyBlocking, 'postgres/postgres-allow-keycloak-only');
    assert.match(result.reason, /Cannot verify/);
  });

  it('denies fail-closed for a label-scoped zero-rule policy (selection cannot be determined)', async () => {
    const result = await simulatePacketDropInspection('api-1', 'postgres-0', 5432, {
      getPods: async () => pods,
      scanPolicies: async () =>
        makeReport([
          makePolicy({
            name: 'db-only',
            namespace: 'postgres',
            podSelector: '{"app":"postgres"}',
            ingressRuleCount: 0,
          }),
        ]),
    });
    assert.equal(result.canConnect, false);
    assert.equal(result.policyBlocking, 'postgres/db-only');
    assert.match(result.reason, /label-scoped/);
  });

  it('ignores Egress-only policies for an ingress inspection', async () => {
    const result = await simulatePacketDropInspection('api-1', 'postgres-0', 5432, {
      getPods: async () => pods,
      scanPolicies: async () =>
        makeReport([
          makePolicy({
            name: 'egress-only',
            namespace: 'postgres',
            policyTypes: ['Egress'],
            ingressRuleCount: 0,
          }),
        ]),
    });
    assert.equal(result.canConnect, true);
  });

  it('propagates a getPods failure instead of answering', async () => {
    await assert.rejects(
      () =>
        simulatePacketDropInspection('api-1', 'postgres-0', 5432, {
          getPods: async () => {
            throw new Error('kubeconfig missing');
          },
          scanPolicies: async () => makeReport([]),
        }),
      /kubeconfig missing/
    );
  });
});
