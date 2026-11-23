import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateManifest,
  togglePolicyRule,
  listAdmissionPolicies,
  getAdmissionWebhookStatus,
  GUARD_POLICIES_CONFIGMAP,
  GUARD_POLICIES_NAMESPACE,
  InvalidManifestError,
  type AdmissionPolicyRule,
  type GuardDeps,
} from '../guard.js';
import { ClusterUnavailableError } from '../errors.js';
import type { CommandWaitResult } from '../executor.js';
import { parseYaml } from '../yaml.js';

/** Batch C, C3: evaluateManifest reads parsed YAML fields, not substrings. */

/**
 * Offline stub for the evaluation tests: the lazy sync probes first and
 * short-circuits with no cluster, so no kubectl is ever spawned. Keeps
 * the evaluation tests hermetic (no real task records, no store attach).
 */
const LOCAL_DEPS: GuardDeps = {
  probeCluster: async () => false,
  runKubectl: async () => {
    throw new Error('LOCAL_DEPS must never call kubectl');
  },
};

/** Evaluation with the offline stub (see LOCAL_DEPS). */
const evaluateLocal = (yaml: string) => evaluateManifest(yaml, LOCAL_DEPS);

function okResult(stdout: string): CommandWaitResult {
  return { code: 0, status: 'completed', logs: [], stdout, stderr: '', taskId: 'test-ok' };
}

function notFoundResult(): CommandWaitResult {
  return {
    code: 1,
    status: 'failed',
    logs: [],
    stdout: '',
    stderr: `Error from server (NotFound): configmaps "${GUARD_POLICIES_CONFIGMAP}" not found`,
    taskId: 'test-not-found',
  };
}

/**
 * In-memory kubectl simulator for the persistence tests: `storedJson`
 * is the ConfigMap's `rules.json` value (null = no ConfigMap yet).
 * `applyPersists: false` simulates an apply that reports success but
 * never lands, so the read-back verification can be tested.
 */
function makeFakeCluster(opts: {
  webhooks?: { validating: string[]; mutating: string[] };
  applyPersists?: boolean;
} = {}) {
  const calls: { args: string[]; input?: string }[] = [];
  const webhooks = opts.webhooks ?? { validating: [], mutating: [] };
  const applyPersists = opts.applyPersists ?? true;
  let storedJson: string | null = null;

  const runKubectl = async (args: string[], input?: string): Promise<CommandWaitResult> => {
    calls.push({ args, input });
    if (args[0] === 'get' && args[1] === 'configmap') {
      if (storedJson === null) return notFoundResult();
      return okResult(
        JSON.stringify({
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: GUARD_POLICIES_CONFIGMAP, namespace: GUARD_POLICIES_NAMESPACE },
          data: { 'rules.json': storedJson },
        })
      );
    }
    if (args[0] === 'get' && args[1] === 'validatingwebhookconfiguration') {
      return okResult(
        JSON.stringify({ items: webhooks.validating.map((name) => ({ metadata: { name } })) })
      );
    }
    if (args[0] === 'get' && args[1] === 'mutatingwebhookconfiguration') {
      return okResult(
        JSON.stringify({ items: webhooks.mutating.map((name) => ({ metadata: { name } })) })
      );
    }
    if (args[0] === 'apply') {
      if (applyPersists) {
        const manifest = parseYaml<Record<string, unknown>>(input ?? '');
        const data = manifest.data as Record<string, unknown> | undefined;
        const rulesJson = data?.['rules.json'];
        if (typeof rulesJson !== 'string') {
          throw new Error('fake cluster: applied manifest has no rules.json string');
        }
        storedJson = rulesJson;
      }
      return okResult(`configmap/${GUARD_POLICIES_CONFIGMAP} configured`);
    }
    throw new Error(`unexpected kubectl call: ${args.join(' ')}`);
  };

  const deps: GuardDeps = { probeCluster: async () => true, runKubectl };
  return {
    deps,
    calls,
    runKubectl,
    getStored: (): AdmissionPolicyRule[] | null =>
      storedJson === null ? null : (JSON.parse(storedJson) as AdmissionPolicyRule[]),
    setStored: (rules: AdmissionPolicyRule[] | null) => {
      storedJson = rules === null ? null : JSON.stringify(rules);
    },
    setStoredJson: (json: string) => {
      storedJson = json;
    },
  };
}

const CLEAN_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: clean-service
  labels:
    app: clean-service
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
      - name: api
        image: api:1.2.3
        securityContext:
          readOnlyRootFilesystem: true
        resources:
          limits:
            cpu: 500m
            memory: 512Mi
`;

async function enableAllRules(): Promise<void> {
  // Fresh fake per call: the toggle writes the all-enabled set into the
  // fake's ConfigMap, which is discarded — the module-level rules are
  // what the next test observes.
  const fake = makeFakeCluster();
  const rules: AdmissionPolicyRule[] = await listAdmissionPolicies(fake.deps);
  for (const rule of rules) {
    await togglePolicyRule(rule.id, true, fake.deps);
  }
}

afterEach(async () => {
  await enableAllRules();
});

describe('evaluateManifest (C3)', () => {
  it('passes a clean deployment with score 100 and compliant true', async () => {
    const result = await evaluateLocal(CLEAN_DEPLOYMENT);
    assert.equal(result.totalRules, 6);
    assert.equal(result.passedRules, 6);
    assert.equal(result.failedRules, 0);
    assert.equal(result.score, 100);
    assert.equal(result.compliant, true);
  });

  it('does NOT reject a comment-only privileged: true', async () => {
    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: commented-service
spec:
  template:
    spec:
      containers:
      - name: api
        # privileged: true (this is only a comment)
        image: api:1.2.3
        securityContext:
          runAsNonRoot: true
          runAsUser: 10001
          readOnlyRootFilesystem: true
        resources:
          limits:
            cpu: 500m
            memory: 512Mi
`;
    const result = await evaluateLocal(yaml);
    const privileged = result.findings.find((f) => f.ruleId === 'disallow-privileged-containers');
    assert.ok(privileged);
    assert.equal(privileged.passed, true);
  });

  it('fails the pinned-version rule for an untagged image', async () => {
    const yaml = CLEAN_DEPLOYMENT.replace('image: api:1.2.3', 'image: api');
    const result = await evaluateLocal(yaml);
    const tagRule = result.findings.find((f) => f.ruleId === 'disallow-latest-image-tag');
    assert.ok(tagRule);
    assert.equal(tagRule.passed, false);
  });

  it('fails the pinned-version rule for :latest but passes digest-pinned and non-semver tags', async () => {
    const latest = await evaluateLocal(CLEAN_DEPLOYMENT.replace('image: api:1.2.3', 'image: api:latest'));
    assert.equal(
      latest.findings.find((f) => f.ruleId === 'disallow-latest-image-tag')?.passed,
      false
    );

    const digest = await evaluateLocal(
      CLEAN_DEPLOYMENT.replace('image: api:1.2.3', 'image: api@sha256:abc123')
    );
    assert.equal(
      digest.findings.find((f) => f.ruleId === 'disallow-latest-image-tag')?.passed,
      true
    );

    const distroTag = await evaluateLocal(
      CLEAN_DEPLOYMENT.replace('image: api:1.2.3', 'image: api:27.1-apache')
    );
    assert.equal(
      distroTag.findings.find((f) => f.ruleId === 'disallow-latest-image-tag')?.passed,
      true
    );
  });

  it('is non-compliant when a privileged container fails a HIGH rule even with 5 passing rules', async () => {
    const yaml = CLEAN_DEPLOYMENT.replace(
      'readOnlyRootFilesystem: true',
      'readOnlyRootFilesystem: true\n          privileged: true'
    );
    const result = await evaluateLocal(yaml);
    assert.equal(result.passedRules, 5);
    assert.equal(result.failedRules, 1);
    assert.equal(result.score, 83);
    assert.equal(result.compliant, false);
    assert.equal(
      result.findings.find((f) => f.ruleId === 'disallow-privileged-containers')?.passed,
      false
    );
  });

  it('skips a disabled rule entirely', async () => {
    const fake = makeFakeCluster();
    await togglePolicyRule('disallow-privileged-containers', false, fake.deps);
    const yaml = CLEAN_DEPLOYMENT.replace(
      'readOnlyRootFilesystem: true',
      'readOnlyRootFilesystem: true\n          privileged: true'
    );
    const result = await evaluateLocal(yaml);
    assert.equal(result.totalRules, 5);
    assert.equal(
      result.findings.some((f) => f.ruleId === 'disallow-privileged-containers'),
      false
    );
    assert.equal(result.compliant, true);
  });

  it('requires BOTH cpu and memory limits', async () => {
    const cpuOnly = CLEAN_DEPLOYMENT.replace('            memory: 512Mi\n', '');
    const result = await evaluateLocal(cpuOnly);
    assert.equal(
      result.findings.find((f) => f.ruleId === 'require-resource-limits')?.passed,
      false
    );
  });

  it('honors pod-level runAsNonRoot/runAsUser inheritance, and rejects runAsUser 0', async () => {
    // CLEAN_DEPLOYMENT already sets pod-level runAsNonRoot + runAsUser 10001
    // with no container-level user fields: the non-root rule passes.
    const result = await evaluateLocal(CLEAN_DEPLOYMENT);
    assert.equal(
      result.findings.find((f) => f.ruleId === 'require-non-root-user')?.passed,
      true
    );

    const rootUser = CLEAN_DEPLOYMENT.replace('runAsUser: 10001', 'runAsUser: 0');
    const rootResult = await evaluateLocal(rootUser);
    assert.equal(
      rootResult.findings.find((f) => f.ruleId === 'require-non-root-user')?.passed,
      false
    );
  });

  it('fails hostNetwork sharing', async () => {
    const yaml = CLEAN_DEPLOYMENT.replace(
      '    spec:\n      securityContext:',
      '    spec:\n      hostNetwork: true\n      securityContext:'
    );
    const result = await evaluateLocal(yaml);
    assert.equal(
      result.findings.find((f) => f.ruleId === 'disallow-host-network-ipc')?.passed,
      false
    );
  });

  it('evaluates a CronJob through spec.jobTemplate.spec.template.spec', async () => {
    const yaml = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-job
spec:
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: job
            image: job:1.0.0
            securityContext:
              privileged: true
`;
    const result = await evaluateLocal(yaml);
    assert.equal(
      result.findings.find((f) => f.ruleId === 'disallow-privileged-containers')?.passed,
      false
    );
  });

  it('mutation sets readOnlyRootFilesystem: true and injects the managed-by label as real fields', async () => {
    const yaml = CLEAN_DEPLOYMENT.replace(
      '        securityContext:\n          readOnlyRootFilesystem: true\n',
      ''
    );
    const result = await evaluateLocal(yaml);
    assert.ok(result.mutatedYaml);
    const mutated = parseYaml<Record<string, unknown>>(result.mutatedYaml);
    const labels = (mutated.metadata as Record<string, unknown>).labels as Record<string, unknown>;
    assert.equal(labels['app.kubernetes.io/managed-by'], 'vigilant-octo-waffle');
    const spec = mutated.spec as Record<string, unknown>;
    const template = spec.template as Record<string, unknown>;
    const podSpec = template.spec as Record<string, unknown>;
    const containers = podSpec.containers as Array<Record<string, unknown>>;
    assert.equal(
      (containers[0].securityContext as Record<string, unknown>).readOnlyRootFilesystem,
      true
    );
  });

  it('throws InvalidManifestError on unparseable YAML and on non-mapping documents', async () => {
    await assert.rejects(() => evaluateLocal('key: [unclosed'), InvalidManifestError);
    await assert.rejects(() => evaluateLocal('just a string'), InvalidManifestError);
  });

  it('marks the guard page vulnerable sample non-compliant and the secure sample compliant', async () => {
    const vulnerable = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: insecure-payment-service
  namespace: default
  labels:
    app: payment-service
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: payment-api
        image: payment-api:latest
        securityContext:
          privileged: true
`;
    const vulnerableResult = await evaluateLocal(vulnerable);
    assert.equal(vulnerableResult.compliant, false);
    assert.equal(vulnerableResult.score, 17);

    const secure = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: hardened-payment-service
  namespace: default
  labels:
    app: payment-service
    app.kubernetes.io/managed-by: vigilant-octo-waffle
spec:
  replicas: 2
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
      - name: payment-api
        image: payment-api:v2.4.1
        securityContext:
          privileged: false
          readOnlyRootFilesystem: true
        resources:
          limits:
            cpu: 500m
            memory: 512Mi
          requests:
            cpu: 100m
            memory: 128Mi
`;
    const secureResult = await evaluateLocal(secure);
    assert.equal(secureResult.compliant, true);
    assert.equal(secureResult.score, 100);
  });
});

describe('toggle persistence (ConfigMap, Phase 1)', () => {
  const PRIVILEGED_YAML = CLEAN_DEPLOYMENT.replace(
    'readOnlyRootFilesystem: true',
    'readOnlyRootFilesystem: true\n          privileged: true'
  );

  it('toggle, list and webhook status error with ClusterUnavailableError when the cluster is unreachable, and kubectl is never called', async () => {
    let kubectlCalls = 0;
    const deps: GuardDeps = {
      probeCluster: async () => false,
      runKubectl: async () => {
        kubectlCalls += 1;
        throw new Error('must not be called');
      },
    };
    await assert.rejects(
      () => togglePolicyRule('disallow-privileged-containers', false, deps),
      ClusterUnavailableError
    );
    await assert.rejects(() => listAdmissionPolicies(deps), ClusterUnavailableError);
    await assert.rejects(() => getAdmissionWebhookStatus(deps), ClusterUnavailableError);
    assert.equal(kubectlCalls, 0);
  });

  it('toggle persists the full rule set to the ConfigMap and reads it back', async () => {
    const fake = makeFakeCluster();
    const updated = await togglePolicyRule('disallow-privileged-containers', false, fake.deps);
    assert.ok(updated);
    assert.equal(updated.id, 'disallow-privileged-containers');
    assert.equal(updated.enabled, false);

    // get (sync), apply, get (read-back verification)
    assert.equal(fake.calls.length, 3);
    assert.deepEqual(fake.calls[0].args, [
      'get',
      'configmap',
      GUARD_POLICIES_CONFIGMAP,
      '-n',
      GUARD_POLICIES_NAMESPACE,
      '-o',
      'json',
    ]);
    assert.deepEqual(fake.calls[1].args, ['apply', '-f', '-']);
    assert.deepEqual(fake.calls[2].args, fake.calls[0].args);

    // The applied manifest is a real ConfigMap built as YAML objects.
    const manifest = parseYaml<Record<string, unknown>>(fake.calls[1].input as string);
    assert.equal(manifest.kind, 'ConfigMap');
    const metadata = manifest.metadata as Record<string, unknown>;
    assert.equal(metadata.name, GUARD_POLICIES_CONFIGMAP);
    assert.equal(metadata.namespace, GUARD_POLICIES_NAMESPACE);
    const data = manifest.data as Record<string, unknown>;
    const stored = JSON.parse(data['rules.json'] as string) as AdmissionPolicyRule[];
    assert.equal(stored.length, 7);
    assert.equal(
      stored.find((r) => r.id === 'disallow-privileged-containers')?.enabled,
      false
    );
    assert.equal(stored.filter((r) => r.enabled).length, 6);

    // The fake cluster agrees, and a fresh list reads the persisted state back.
    assert.equal(
      fake.getStored()?.find((r) => r.id === 'disallow-privileged-containers')?.enabled,
      false
    );
    const listed = await listAdmissionPolicies(fake.deps);
    assert.equal(
      listed.find((r) => r.id === 'disallow-privileged-containers')?.enabled,
      false
    );
  });

  it('toggle loads persisted state first, so it never clobbers a rule changed elsewhere', async () => {
    const fake = makeFakeCluster();
    const base = await listAdmissionPolicies(fake.deps);
    fake.setStored(
      base.map((r) => (r.id === 'require-read-only-rootfs' ? { ...r, enabled: false } : r))
    );
    const updated = await togglePolicyRule('disallow-privileged-containers', false, fake.deps);
    assert.ok(updated);
    const persisted = fake.getStored();
    assert.equal(
      persisted?.find((r) => r.id === 'require-read-only-rootfs')?.enabled,
      false
    );
    assert.equal(
      persisted?.find((r) => r.id === 'disallow-privileged-containers')?.enabled,
      false
    );
  });

  it('toggle returns null for an unknown id and writes nothing', async () => {
    const fake = makeFakeCluster();
    const result = await togglePolicyRule('no-such-rule', false, fake.deps);
    assert.equal(result, null);
    assert.equal(fake.calls.filter((c) => c.args[0] === 'apply').length, 0);
    assert.equal(fake.getStored(), null);
  });

  it('toggle throws when the apply fails and leaves in-memory state unchanged', async () => {
    const fake = makeFakeCluster();
    const failingDeps: GuardDeps = {
      probeCluster: async () => true,
      runKubectl: async (args, input) => {
        if (args[0] === 'apply') {
          return {
            code: 1,
            status: 'failed',
            logs: [],
            stdout: '',
            stderr: 'Error from server (Forbidden): configmaps is forbidden',
            taskId: 'test-apply-fail',
          };
        }
        return fake.runKubectl(args, input);
      },
    };
    await assert.rejects(
      () => togglePolicyRule('disallow-privileged-containers', false, failingDeps),
      /kubectl apply -f - \(guard policies ConfigMap\) failed/
    );
    assert.equal(fake.getStored(), null);
    const listed = await listAdmissionPolicies(fake.deps);
    assert.equal(
      listed.find((r) => r.id === 'disallow-privileged-containers')?.enabled,
      true
    );
  });

  it('toggle throws when the apply reports success but the read-back does not show it', async () => {
    const fake = makeFakeCluster({ applyPersists: false });
    await assert.rejects(
      () => togglePolicyRule('disallow-privileged-containers', false, fake.deps),
      /could not be read back/
    );
  });

  it('list returns persisted enabled flags', async () => {
    const fake = makeFakeCluster();
    const base = await listAdmissionPolicies(fake.deps);
    fake.setStored(
      base.map((r) =>
        r.id === 'require-resource-limits' || r.id === 'disallow-host-network-ipc'
          ? { ...r, enabled: false }
          : r
      )
    );
    const listed = await listAdmissionPolicies(fake.deps);
    assert.equal(listed.find((r) => r.id === 'require-resource-limits')?.enabled, false);
    assert.equal(listed.find((r) => r.id === 'disallow-host-network-ipc')?.enabled, false);
    assert.equal(listed.filter((r) => r.enabled).length, 5);
  });

  it('list falls back to the in-memory defaults when no ConfigMap exists', async () => {
    // afterEach re-enabled every rule, so the in-memory defaults are all on.
    const fake = makeFakeCluster();
    const rules = await listAdmissionPolicies(fake.deps);
    assert.equal(rules.filter((r) => r.enabled).length, 7);
  });

  it('list throws on a malformed ConfigMap', async () => {
    const fake = makeFakeCluster();
    fake.setStoredJson('not json at all');
    await assert.rejects(() => listAdmissionPolicies(fake.deps), /malformed/);
    fake.setStoredJson(JSON.stringify([{ id: 'disallow-privileged-containers' }]));
    await assert.rejects(() => listAdmissionPolicies(fake.deps), /malformed/);
    fake.setStoredJson(JSON.stringify('just a string'));
    await assert.rejects(() => listAdmissionPolicies(fake.deps), /malformed/);
  });

  it('evaluation uses persisted flags after a sync, and defaults when the sync fails', async () => {
    const fake = makeFakeCluster();
    const base = await listAdmissionPolicies(fake.deps);
    fake.setStored(
      base.map((r) =>
        r.id === 'disallow-privileged-containers' ? { ...r, enabled: false } : r
      )
    );
    const synced = await evaluateManifest(PRIVILEGED_YAML, fake.deps);
    assert.equal(synced.totalRules, 5);
    assert.equal(
      synced.findings.some((f) => f.ruleId === 'disallow-privileged-containers'),
      false
    );
    assert.equal(synced.compliant, true);

    // Sync failure (API down): evaluation still works on in-memory rules.
    await enableAllRules();
    const failingDeps: GuardDeps = {
      probeCluster: async () => true,
      runKubectl: async () => ({
        code: 1,
        status: 'failed',
        logs: [],
        stdout: '',
        stderr: 'Error from server: connection refused',
        taskId: 'test-down',
      }),
    };
    const offline = await evaluateManifest(PRIVILEGED_YAML, failingDeps);
    assert.equal(offline.totalRules, 6);
    assert.equal(
      offline.findings.find((f) => f.ruleId === 'disallow-privileged-containers')?.passed,
      false
    );
    assert.equal(offline.compliant, false);
  });

  it('webhook status lists live webhook configurations, sorted', async () => {
    const fake = makeFakeCluster({
      webhooks: {
        validating: ['kyverno-validating', 'a-policy'],
        mutating: ['kyverno-mutating'],
      },
    });
    const status = await getAdmissionWebhookStatus(fake.deps);
    assert.equal(status.installed, true);
    assert.deepEqual(status.validating, ['a-policy', 'kyverno-validating']);
    assert.deepEqual(status.mutating, ['kyverno-mutating']);
    assert.equal(status.error, undefined);

    const empty = await getAdmissionWebhookStatus(makeFakeCluster().deps);
    assert.equal(empty.installed, false);
    assert.deepEqual(empty.validating, []);
    assert.deepEqual(empty.mutating, []);
  });

  it('webhook status degrades to error instead of claiming none installed', async () => {
    const failingDeps: GuardDeps = {
      probeCluster: async () => true,
      runKubectl: async () => ({
        code: 1,
        status: 'failed',
        logs: [],
        stdout: '',
        stderr: 'Error from server (Forbidden): validatingwebhookconfigurations is forbidden',
        taskId: 'test-rbac',
      }),
    };
    const status = await getAdmissionWebhookStatus(failingDeps);
    assert.equal(status.installed, false);
    assert.equal(status.error, 'Could not list admission webhooks');
  });
});
