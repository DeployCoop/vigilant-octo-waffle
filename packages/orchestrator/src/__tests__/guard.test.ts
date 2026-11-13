import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateManifest,
  togglePolicyRule,
  listAdmissionPolicies,
  InvalidManifestError,
  type AdmissionPolicyRule,
} from '../guard.js';
import { parseYaml } from '../yaml.js';

/** Batch C, C3: evaluateManifest reads parsed YAML fields, not substrings. */

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
  const rules: AdmissionPolicyRule[] = await listAdmissionPolicies();
  for (const rule of rules) {
    await togglePolicyRule(rule.id, true);
  }
}

afterEach(async () => {
  await enableAllRules();
});

describe('evaluateManifest (C3)', () => {
  it('passes a clean deployment with score 100 and compliant true', async () => {
    const result = await evaluateManifest(CLEAN_DEPLOYMENT);
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
    const result = await evaluateManifest(yaml);
    const privileged = result.findings.find((f) => f.ruleId === 'disallow-privileged-containers');
    assert.ok(privileged);
    assert.equal(privileged.passed, true);
  });

  it('fails the pinned-version rule for an untagged image', async () => {
    const yaml = CLEAN_DEPLOYMENT.replace('image: api:1.2.3', 'image: api');
    const result = await evaluateManifest(yaml);
    const tagRule = result.findings.find((f) => f.ruleId === 'disallow-latest-image-tag');
    assert.ok(tagRule);
    assert.equal(tagRule.passed, false);
  });

  it('fails the pinned-version rule for :latest but passes digest-pinned and non-semver tags', async () => {
    const latest = await evaluateManifest(CLEAN_DEPLOYMENT.replace('image: api:1.2.3', 'image: api:latest'));
    assert.equal(
      latest.findings.find((f) => f.ruleId === 'disallow-latest-image-tag')?.passed,
      false
    );

    const digest = await evaluateManifest(
      CLEAN_DEPLOYMENT.replace('image: api:1.2.3', 'image: api@sha256:abc123')
    );
    assert.equal(
      digest.findings.find((f) => f.ruleId === 'disallow-latest-image-tag')?.passed,
      true
    );

    const distroTag = await evaluateManifest(
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
    const result = await evaluateManifest(yaml);
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
    await togglePolicyRule('disallow-privileged-containers', false);
    const yaml = CLEAN_DEPLOYMENT.replace(
      'readOnlyRootFilesystem: true',
      'readOnlyRootFilesystem: true\n          privileged: true'
    );
    const result = await evaluateManifest(yaml);
    assert.equal(result.totalRules, 5);
    assert.equal(
      result.findings.some((f) => f.ruleId === 'disallow-privileged-containers'),
      false
    );
    assert.equal(result.compliant, true);
  });

  it('requires BOTH cpu and memory limits', async () => {
    const cpuOnly = CLEAN_DEPLOYMENT.replace('            memory: 512Mi\n', '');
    const result = await evaluateManifest(cpuOnly);
    assert.equal(
      result.findings.find((f) => f.ruleId === 'require-resource-limits')?.passed,
      false
    );
  });

  it('honors pod-level runAsNonRoot/runAsUser inheritance, and rejects runAsUser 0', async () => {
    // CLEAN_DEPLOYMENT already sets pod-level runAsNonRoot + runAsUser 10001
    // with no container-level user fields: the non-root rule passes.
    const result = await evaluateManifest(CLEAN_DEPLOYMENT);
    assert.equal(
      result.findings.find((f) => f.ruleId === 'require-non-root-user')?.passed,
      true
    );

    const rootUser = CLEAN_DEPLOYMENT.replace('runAsUser: 10001', 'runAsUser: 0');
    const rootResult = await evaluateManifest(rootUser);
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
    const result = await evaluateManifest(yaml);
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
    const result = await evaluateManifest(yaml);
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
    const result = await evaluateManifest(yaml);
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
    await assert.rejects(() => evaluateManifest('key: [unclosed'), InvalidManifestError);
    await assert.rejects(() => evaluateManifest('just a string'), InvalidManifestError);
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
    const vulnerableResult = await evaluateManifest(vulnerable);
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
    const secureResult = await evaluateManifest(secure);
    assert.equal(secureResult.compliant, true);
    assert.equal(secureResult.score, 100);
  });
});
