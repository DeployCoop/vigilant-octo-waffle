import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffDesiredVsLive,
  findOrphanedLiveObjects,
  buildUnifiedDiff,
  buildDiffId,
  appNameFromDiffId,
  normalizeForCompare,
  objectKey,
  type K8sObject,
} from '../live-git-diff.js';

/** Batch C wiring, Phase 1: the shared live-vs-desired diff engine. */

function deployment(overrides: Record<string, unknown> = {}): K8sObject {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'nextcloud', namespace: 'nextcloud', labels: { app: 'nextcloud' } },
    spec: {
      replicas: 1,
      template: {
        spec: {
          containers: [
            {
              name: 'nextcloud',
              image: 'nextcloud:27.1-apache',
              env: [
                { name: 'KC_DB', value: 'postgres' },
                { name: 'KC_HTTP_ENABLED', value: 'true' },
              ],
              resources: {
                limits: { cpu: '1000m', memory: '1Gi' },
                requests: { cpu: '250m', memory: '512Mi' },
              },
            },
          ],
        },
      },
    },
    ...overrides,
  };
}

function liveDeployment(overrides: Record<string, unknown> = {}): K8sObject {
  const base = deployment();
  return {
    ...base,
    metadata: {
      ...(base.metadata as Record<string, unknown>),
      uid: 'abc-123',
      resourceVersion: '4242',
      creationTimestamp: '2026-11-12T00:00:00Z',
      annotations: {
        'kubectl.kubernetes.io/last-applied-configuration': '{"spec":{}}',
        'deployment.kubernetes.io/revision': '3',
      },
    },
    // Server-side defaults git never declares: ignored, not drift.
    status: { replicas: 1, readyReplicas: 1 },
    ...overrides,
  };
}

describe('buildDiffId / appNameFromDiffId', () => {
  it('round-trips the app through the id', () => {
    const id = buildDiffId('drift', 'nextcloud', 'Deployment', 'nextcloud', 'nextcloud');
    assert.equal(id, 'drift:nextcloud:deployment:nextcloud:nextcloud');
    assert.equal(appNameFromDiffId(id), 'nextcloud');
    assert.equal(appNameFromDiffId('drift-nextcloud-replicas'), null);
    assert.equal(appNameFromDiffId('drift:nextcloud:deployment:nextcloud'), null);
  });
});

describe('normalizeForCompare', () => {
  it('strips live-only fields but keeps declared ones', () => {
    const normalized = normalizeForCompare(liveDeployment());
    assert.equal((normalized as Record<string, unknown>).status, undefined);
    const meta = normalized.metadata as Record<string, unknown>;
    assert.equal(meta.uid, undefined);
    assert.equal(meta.resourceVersion, undefined);
    assert.equal(meta.annotations, undefined);
    assert.equal((normalized.spec as Record<string, unknown>).replicas, 1);
  });
});

describe('diffDesiredVsLive', () => {
  it('reports nothing when live matches git plus server-side defaults', () => {
    const items = diffDesiredVsLive(
      [{ object: deployment(), appName: 'nextcloud', gitFilePath: 'charts/nextcloud/templates/deployment.yaml' }],
      [liveDeployment()],
      {}
    );
    assert.equal(items.length, 0);
  });

  it('detects a replica-count drift with the old diff-summary shape', () => {
    const live = liveDeployment();
    (live.spec as Record<string, unknown>).replicas = 3;
    const items = diffDesiredVsLive(
      [{ object: deployment(), appName: 'nextcloud', gitFilePath: 'charts/nextcloud/templates/deployment.yaml' }],
      [live],
      {}
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].driftType, 'REPLICA_COUNT_DRIFT');
    assert.equal(items[0].severity, 'MEDIUM');
    assert.equal(items[0].diffSummary, 'spec.replicas: Git (1) ≠ Cluster (3)');
    assert.match(items[0].gitContent, /replicas: 1/);
    assert.match(items[0].liveContent, /replicas: 3/);
    assert.equal(items[0].id, 'drift:nextcloud:deployment:nextcloud:nextcloud');
  });

  it('detects an image-tag drift', () => {
    const live = liveDeployment();
    const spec = live.spec as Record<string, Record<string, unknown>>;
    const containers = (spec.template as Record<string, Record<string, unknown[]>>).spec
      .containers as Record<string, unknown>[];
    containers[0].image = 'nextcloud:28.0-apache';
    const items = diffDesiredVsLive(
      [{ object: deployment(), appName: 'nextcloud', gitFilePath: 'charts/nextcloud/templates/deployment.yaml' }],
      [live],
      {}
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].driftType, 'IMAGE_TAG_DRIFT');
    assert.match(items[0].diffSummary, /image: Git \(nextcloud:27\.1-apache\) ≠ Cluster \(nextcloud:28\.0-apache\)/);
  });

  it('matches env vars by name, order-insensitive, and reports a hot-patched extra', () => {
    const live = liveDeployment();
    const spec = live.spec as Record<string, Record<string, unknown>>;
    const containers = (spec.template as Record<string, Record<string, unknown[]>>).spec
      .containers as Record<string, unknown>[];
    // Reorder the declared vars and add a hot-patched one (the hunt's
    // drift-keycloak-env case). Reordering alone is not drift; the extra
    // element is — the server never invents a named env var.
    containers[0].env = [
      { name: 'KC_LOG_LEVEL', value: 'DEBUG' },
      { name: 'KC_HTTP_ENABLED', value: 'true' },
      { name: 'KC_DB', value: 'postgres' },
    ];
    const items = diffDesiredVsLive(
      [{ object: deployment(), appName: 'nextcloud', gitFilePath: 'charts/nextcloud/templates/deployment.yaml' }],
      [live],
      {}
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].driftType, 'ENV_VAR_DRIFT');
    assert.equal(items[0].severity, 'LOW');
    assert.match(items[0].diffSummary, /KC_LOG_LEVEL/);
    assert.match(items[0].diffSummary, /Git \(\(missing\)\)/);
    // The extra var is visible in the live panel, not only the summary.
    assert.match(items[0].liveContent, /KC_LOG_LEVEL/);
    assert.doesNotMatch(items[0].gitContent, /KC_LOG_LEVEL/);
  });

  it('detects a changed env value and a resource-limit drift', () => {
    const live = liveDeployment();
    const spec = live.spec as Record<string, Record<string, unknown>>;
    const containers = (spec.template as Record<string, Record<string, unknown[]>>).spec
      .containers as Record<string, unknown>[];
    (containers[0].env as Record<string, unknown>[])[0].value = 'mysql';
    ((containers[0].resources as Record<string, Record<string, string>>).limits).memory = '2Gi';
    const items = diffDesiredVsLive(
      [{ object: deployment(), appName: 'nextcloud', gitFilePath: 'charts/nextcloud/templates/deployment.yaml' }],
      [live],
      {}
    );
    assert.equal(items.length, 1);
    // Env is checked before resources in the classification priority.
    assert.equal(items[0].driftType, 'ENV_VAR_DRIFT');
    assert.equal(items[0].severity, 'LOW');
    assert.match(items[0].diffSummary, /KC_DB/);
  });

  it('classifies an unrecognized field diff as SPEC_DRIFT', () => {
    const live = liveDeployment();
    const spec = live.spec as Record<string, unknown>;
    (spec.template as Record<string, Record<string, unknown>>).metadata = {
      labels: { app: 'nextcloud', tier: 'hot-patched' },
    };
    const desired = deployment();
    (desired.spec as Record<string, unknown>).template = {
      metadata: { labels: { app: 'nextcloud' } },
      spec: (desired.spec as Record<string, Record<string, unknown>>).template.spec,
    };
    const items = diffDesiredVsLive(
      [{ object: desired, appName: 'nextcloud', gitFilePath: 'charts/nextcloud/templates/deployment.yaml' }],
      [live],
      {}
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].driftType, 'SPEC_DRIFT');
    assert.equal(items[0].severity, 'MEDIUM');
    assert.match(items[0].diffSummary, /tier/);
    // The hot-patched label is visible in the live panel, not only the summary.
    assert.match(items[0].liveContent, /tier: hot-patched/);
    assert.doesNotMatch(items[0].gitContent, /tier/);
  });

  it('reports a declared-but-missing resource as HIGH with an absence marker', () => {
    const items = diffDesiredVsLive(
      [{ object: deployment(), appName: 'nextcloud', gitFilePath: 'charts/nextcloud/templates/deployment.yaml' }],
      [],
      {}
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].driftType, 'SPEC_DRIFT');
    assert.equal(items[0].severity, 'HIGH');
    assert.equal(items[0].liveContent, '# not present in cluster');
    assert.match(items[0].diffSummary, /not present in the cluster/);
  });

  it('reports no orphans from the diff itself (orphans are a separate global pass)', () => {
    const orphanService: K8sObject = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'rogue-svc', namespace: 'nextcloud' },
      spec: { ports: [{ port: 80 }] },
    };
    const items = diffDesiredVsLive(
      [{ object: deployment(), appName: 'nextcloud', gitFilePath: 'charts/nextcloud/templates/deployment.yaml' }],
      [liveDeployment(), orphanService],
      {}
    );
    assert.equal(items.length, 0);
  });
});

describe('findOrphanedLiveObjects', () => {
  it('reports an unowned live extra as ORPHANED_RESOURCE and ignores owned ones', () => {
    const orphanService: K8sObject = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'rogue-svc', namespace: 'nextcloud' },
      spec: { ports: [{ port: 80 }] },
    };
    const ownedPod: K8sObject = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: 'nextcloud-abc123',
        namespace: 'nextcloud',
        ownerReferences: [{ name: 'nextcloud-xyz', kind: 'ReplicaSet' }],
      },
      spec: { containers: [{ name: 'nextcloud', image: 'nextcloud:27.1-apache' }] },
    };
    const kubeSvc: K8sObject = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'kubernetes', namespace: 'default' },
      spec: { clusterIP: '10.43.0.1' },
    };
    const desiredKeys = new Set([objectKey('Deployment', 'nextcloud', 'nextcloud')]);
    const items = findOrphanedLiveObjects(desiredKeys, [liveDeployment(), orphanService, ownedPod, kubeSvc], {
      attribute: () => ({ appName: 'nextcloud', gitFilePath: 'charts/nextcloud' }),
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].driftType, 'ORPHANED_RESOURCE');
    assert.equal(items[0].resourceName, 'rogue-svc');
    assert.equal(items[0].gitContent, '# not declared in Git');
    assert.equal(items[0].gitFilePath, 'charts/nextcloud');
    assert.equal(items[0].id, 'drift:nextcloud:service:nextcloud:rogue-svc');
  });
});

describe('buildUnifiedDiff', () => {
  it('produces a unified diff of git vs live content', () => {
    const git = 'spec:\n  replicas: 1\n  image: nextcloud:27.1\n';
    const live = 'spec:\n  replicas: 3\n  image: nextcloud:27.1\n';
    const patch = buildUnifiedDiff('charts/nextcloud/templates/deployment.yaml', git, live);
    assert.match(patch, /^--- a\/charts\/nextcloud\/templates\/deployment\.yaml$/m);
    assert.match(patch, /^\+\+\+ b\/charts\/nextcloud\/templates\/deployment\.yaml$/m);
    assert.match(patch, /^- {2}replicas: 1$/m);
    assert.match(patch, /^\+ {2}replicas: 3$/m);
    assert.match(patch, /^ {3}image: nextcloud:27\.1$/m);
  });

  it('returns an empty string for identical content', () => {
    const content = 'spec:\n  replicas: 1\n';
    assert.equal(buildUnifiedDiff('charts/x/deployment.yaml', content, content), '');
  });
});
