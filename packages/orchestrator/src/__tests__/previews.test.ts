import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPreviewEnvironment,
  destroyPreviewEnvironment,
  extendPreviewTtl,
  cleanupExpiredPreviews,
  listPreviewEnvironments,
  runPreviewReaperCycle,
  stopPreviewReaper,
  verifyPreviewReady,
  PreviewConflictError,
  PreviewAppNotFoundError,
  type PreviewDeps,
} from '../previews.js';
import { ClusterUnavailableError } from '../errors.js';
import type { CommandWaitResult } from '../executor.js';
import type {
  CatalogAppMeta,
  DeployAppResult,
  DeployAppOptions,
} from '../app-deployer.js';

afterEach(() => {
  stopPreviewReaper();
});

/**
 * Expire a preview through the public API: extending by a negative
 * number of minutes pulls expiresAt into the past (the module does
 * not validate the sign — the route schema does). The next list call
 * then marks it expired.
 */
async function expirePreview(id: string, harness: DepsHarness): Promise<void> {
  await extendPreviewTtl(id, -10080, harness.deps);
  await listPreviewEnvironments();
}

const PROJECT_ROOT = '/tmp/vow-previews-test';

function catalogApp(overrides: Partial<CatalogAppMeta> & { appId: string }): CatalogAppMeta {
  return {
    name: overrides.appId,
    category: 'Application',
    defaultNamespace: overrides.appId,
    hasArgoManifest: false,
    hasLocalChart: false,
    hasInit: false,
    enablerVar: `THIS_${overrides.appId.toUpperCase()}_ENABLED`,
    ...overrides,
  };
}

const CATALOG: CatalogAppMeta[] = [
  catalogApp({ appId: 'nextcloud', hasArgoManifest: true }),
  catalogApp({ appId: 'sample-app', hasLocalChart: true }),
];

interface KubectlCall {
  args: string[];
  input?: string;
}

interface StubOptions {
  deploymentsReady?: boolean;
  ingressHosts?: string[];
  deleteNamespaceStuck?: boolean;
}

/** Stateful kubectl stub: namespaces/ingresses appear once created. */
function makeKubectlStub(opts: StubOptions = {}) {
  const calls: KubectlCall[] = [];
  const namespaces = new Set<string>();
  const ingressHosts = new Set<string>(opts.ingressHosts ?? []);

  const fn = async (
    args: string[],
    callOpts?: { input?: string }
  ): Promise<CommandWaitResult> => {
    calls.push({ args, input: callOpts?.input });
    const ok = (stdout: string): CommandWaitResult => ({
      code: 0,
      status: 'completed',
      logs: [],
      stdout,
      stderr: '',
      taskId: 'test-task',
    });
    const fail = (stderr: string): CommandWaitResult => ({
      code: 1,
      status: 'failed',
      logs: [],
      stdout: '',
      stderr,
      taskId: 'test-task',
    });

    if (args[0] === 'get' && args[1] === 'namespace') {
      const ns = args[2];
      return namespaces.has(ns)
        ? ok(JSON.stringify({ metadata: { name: ns } }))
        : fail(`Error from server (NotFound): namespaces "${ns}" not found`);
    }
    if (args[0] === 'get' && args[1] === 'deploy,sts') {
      const items = opts.deploymentsReady
        ? [
            {
              kind: 'Deployment',
              metadata: { name: 'nextcloud' },
              spec: {
                replicas: 1,
                template: { spec: { containers: [{ name: 'nextcloud', image: 'nextcloud:28' }] } },
              },
              status: { availableReplicas: 1 },
            },
          ]
        : [];
      return ok(JSON.stringify({ items }));
    }
    if (args[0] === 'get' && args[1] === 'ingress') {
      const items = [...ingressHosts].map((host) => ({
        kind: 'Ingress',
        metadata: { name: 'preview-ingress' },
        spec: { rules: [{ host }] },
      }));
      return ok(JSON.stringify({ items }));
    }
    if (args[0] === 'get' && args[1] === 'svc') {
      return ok(
        JSON.stringify({
          items: [
            {
              metadata: { name: 'nextcloud' },
              spec: { ports: [{ port: 8080 }] },
            },
          ],
        })
      );
    }
    if (args[0] === 'apply') {
      const input = callOpts?.input ?? '';
      const hostMatch = /host:\s*(\S+)/.exec(input);
      if (hostMatch) ingressHosts.add(hostMatch[1]);
      return ok('ingress.networking.k8s.io/preview-ingress created');
    }
    if (args[0] === 'delete' && args[1] === 'application') {
      return ok('application.argoproj.io deleted');
    }
    if (args[0] === 'delete' && args[1] === 'namespace') {
      const ns = args[2];
      if (opts.deleteNamespaceStuck) {
        return ok(`namespace "${ns}" deleted`);
      }
      namespaces.delete(ns);
      return ok(`namespace "${ns}" deleted`);
    }
    return ok('{}');
  };

  return { fn, calls, namespaces, ingressHosts };
}

interface DepsHarness {
  deps: PreviewDeps;
  kubectl: ReturnType<typeof makeKubectlStub>;
  deployCalls: Array<{ appId: string; options: DeployAppOptions }>;
  ensureCalls: Array<{ name: string }>;
  deployResult: DeployAppResult | null;
  connected: boolean;
}

function makeDeps(opts: StubOptions = {}): DepsHarness {
  const kubectl = makeKubectlStub(opts);
  const deployCalls: DepsHarness['deployCalls'] = [];
  const ensureCalls: DepsHarness['ensureCalls'] = [];
  const harness: DepsHarness = {
    kubectl,
    deployCalls,
    ensureCalls,
    deployResult: null,
    connected: true,
    deps: {
      projectRoot: PROJECT_ROOT,
      startReaper: false,
      ingressClass: 'traefik',
      ensureNamespace: async (_root: string, name: string) => {
        ensureCalls.push({ name });
        kubectl.namespaces.add(name);
      },
      deployApp: async (_root: string, appId: string, options: DeployAppOptions = {}) => {
        deployCalls.push({ appId, options });
        return (
          harness.deployResult ?? {
            appId,
            namespace: options.namespace ?? '',
            engine: options.engine ?? 'argocd',
            success: true,
            message: 'ok',
            manifestApplied: true,
          }
        );
      },
      runKubectl: kubectl.fn,
      getTelemetry: async () => ({ isConnected: harness.connected }),
      listCatalog: () => CATALOG,
    },
  };
  return harness;
}

async function createReady(harness: DepsHarness, prNumber: number, appName = 'nextcloud') {
  return createPreviewEnvironment(
    { prNumber, branch: 'feat/x', appName, ttlMinutes: 120 },
    harness.deps
  );
}

describe('previews (wired to the real cluster)', () => {
  it('create with no cluster throws cluster_unavailable and deploys nothing', async () => {
    const h = makeDeps();
    h.connected = false;
    await assert.rejects(
      () => createPreviewEnvironment({ prNumber: 1, branch: 'feat/x', appName: 'nextcloud' }, h.deps),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
    assert.equal(h.deployCalls.length, 0);
    assert.equal(h.ensureCalls.length, 0);
  });

  it('create for an unknown app throws PreviewAppNotFoundError and creates nothing', async () => {
    const h = makeDeps();
    await assert.rejects(
      () => createPreviewEnvironment({ prNumber: 2, branch: 'feat/x', appName: 'no-such-app' }, h.deps),
      (err: unknown) => err instanceof PreviewAppNotFoundError
    );
    assert.equal(h.ensureCalls.length, 0);
    assert.equal((await listPreviewEnvironments()).length, 0);
  });

  it('create deploys via deployCatalogApp with preview-scoped identity and stays provisioning until verified', async () => {
    const h = makeDeps();
    const preview = await createReady(h, 42);

    assert.equal(preview.status, 'provisioning');
    assert.equal(preview.provisioningStage, 'verifying');
    assert.equal(preview.namespace, 'preview-pr-42-nextcloud');
    assert.equal(preview.subdomain, 'pr-42-nextcloud.127.0.0.1.sslip.io');
    assert.equal(preview.previewUrl, 'http://pr-42-nextcloud.127.0.0.1.sslip.io');
    // No fabricated values: commit/image/replicas are unknown until observed.
    assert.equal(preview.commitSha, '');
    assert.equal(preview.imageTag, '');
    assert.equal(preview.replicas, 0);

    assert.deepEqual(h.ensureCalls, [{ name: 'preview-pr-42-nextcloud' }]);
    assert.equal(h.deployCalls.length, 1);
    assert.equal(h.deployCalls[0].appId, 'nextcloud');
    assert.equal(h.deployCalls[0].options.engine, 'argocd');
    assert.equal(h.deployCalls[0].options.namespace, 'preview-pr-42-nextcloud');
    assert.deepEqual(h.deployCalls[0].options.envOverrides, {
      THIS_NAMESPACE: 'preview-pr-42-nextcloud',
    });
    assert.equal(h.deployCalls[0].options.applicationName, 'preview-pr-42-nextcloud');
    assert.equal(h.deployCalls[0].options.skipInitDirs, true);

    const apply = h.kubectl.calls.find((c) => c.args[0] === 'apply');
    assert.ok(apply, 'expected a kubectl apply for the Ingress');
    assert.ok(apply.input?.includes('host: pr-42-nextcloud.127.0.0.1.sslip.io'));
    assert.ok(apply.input?.includes('name: nextcloud'));
    assert.ok(apply.input?.includes('ingressClassName: traefik'));
  });

  it('create reports ready with observed replicas/image when the workload is already up', async () => {
    const h = makeDeps({
      deploymentsReady: true,
      ingressHosts: ['pr-43-nextcloud.127.0.0.1.sslip.io'],
    });
    const preview = await createReady(h, 43);
    assert.equal(preview.status, 'ready');
    assert.equal(preview.provisioningStage, undefined);
    assert.equal(preview.replicas, 1);
    assert.equal(preview.imageTag, 'nextcloud:28');
  });

  it('create uses the helm engine (wait:false) for chart-only apps', async () => {
    const h = makeDeps();
    const preview = await createPreviewEnvironment(
      { prNumber: 44, branch: 'feat/x', appName: 'sample-app' },
      h.deps
    );
    assert.equal(preview.status, 'provisioning');
    assert.equal(h.deployCalls[0].options.engine, 'helm');
    assert.equal(h.deployCalls[0].options.wait, false);
  });

  it('re-creating a live preview of the same PR + app is a conflict', async () => {
    const h = makeDeps();
    await createReady(h, 45);
    await assert.rejects(() => createReady(h, 45), (err: unknown) => err instanceof PreviewConflictError);
    assert.equal(h.deployCalls.length, 1);
  });

  it('a failed deploy throws, cleans up the namespace, and stores no record', async () => {
    const h = makeDeps();
    h.deployResult = {
      appId: 'nextcloud',
      namespace: 'preview-pr-46-nextcloud',
      engine: 'argocd',
      success: false,
      message: 'Failed to deploy application',
      error: 'boom',
    };
    await assert.rejects(() => createReady(h, 46), /boom/);
    const deleted = h.kubectl.calls.find(
      (c) => c.args[0] === 'delete' && c.args[1] === 'namespace'
    );
    assert.ok(deleted, 'expected a best-effort namespace cleanup');
    assert.equal((await listPreviewEnvironments()).filter((p) => p.prNumber === 46).length, 0);
  });

  it('destroy deletes the Application CR, then the namespace, and confirms it is gone', async () => {
    const h = makeDeps();
    const preview = await createReady(h, 47);
    const result = await destroyPreviewEnvironment(preview.id, h.deps);
    assert.equal(result.success, true);
    const appDelete = h.kubectl.calls.findIndex(
      (c) => c.args[0] === 'delete' && c.args[1] === 'application'
    );
    const nsDelete = h.kubectl.calls.findIndex(
      (c) => c.args[0] === 'delete' && c.args[1] === 'namespace'
    );
    assert.ok(appDelete >= 0 && nsDelete > appDelete, 'Application CR must go before the namespace');
    assert.equal(h.kubectl.calls[appDelete].args[2], 'preview-pr-47-nextcloud');
    assert.equal((await listPreviewEnvironments()).find((p) => p.id === preview.id), undefined);
  });

  it('destroy of an unknown id fails without touching the cluster', async () => {
    const h = makeDeps();
    const result = await destroyPreviewEnvironment('prev-pr-999-nope', h.deps);
    assert.equal(result.success, false);
    assert.equal(h.kubectl.calls.length, 0);
  });

  it('destroy keeps the record when the namespace survives deletion', async () => {
    const h = makeDeps({ deleteNamespaceStuck: true });
    // The stub's delete reports success but leaves the namespace in place,
    // so the confirm `get` still finds it.
    const preview = await createReady(h, 48);
    const result = await destroyPreviewEnvironment(preview.id, h.deps);
    assert.equal(result.success, false);
    assert.ok((await listPreviewEnvironments()).find((p) => p.id === preview.id));
  });

  it('destroy with no cluster throws cluster_unavailable and keeps the record', async () => {
    const h = makeDeps();
    const preview = await createReady(h, 49);
    h.connected = false;
    await assert.rejects(
      () => destroyPreviewEnvironment(preview.id, h.deps),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
    assert.ok((await listPreviewEnvironments()).find((p) => p.id === preview.id));
  });

  it('verifyPreviewReady requires namespace + ready workload + matching Ingress', async () => {
    const h = makeDeps();
    const preview = await createReady(h, 50);
    const readiness = await verifyPreviewReady(PROJECT_ROOT, preview, h.deps);
    assert.equal(readiness.namespaceExists, true);
    assert.equal(readiness.deploymentReady, false);
    assert.equal(readiness.ingressExists, true);
    assert.equal(readiness.ready, false);
  });

  it('verifyPreviewReady reports nothing when the namespace is gone', async () => {
    const h = makeDeps();
    const preview = await createReady(h, 51);
    h.kubectl.namespaces.delete(preview.namespace);
    const readiness = await verifyPreviewReady(PROJECT_ROOT, preview, h.deps);
    assert.equal(readiness.namespaceExists, false);
    assert.equal(readiness.ready, false);
  });

  it('reaper promotes a provisioning preview once the cluster reports ready', async () => {
    const h = makeDeps();
    const preview = await createReady(h, 52);
    assert.equal(preview.status, 'provisioning');
    // The workload comes up after create: flip the stub, then tick.
    const h2 = makeDeps({ deploymentsReady: true });
    h2.kubectl.namespaces.add(preview.namespace);
    h2.kubectl.ingressHosts.add(preview.subdomain);
    await runPreviewReaperCycle(h2.deps);
    const stored = (await listPreviewEnvironments()).find((p) => p.id === preview.id);
    assert.equal(stored?.status, 'ready');
    assert.equal(stored?.replicas, 1);
    assert.equal(stored?.imageTag, 'nextcloud:28');
  });

  it('reaper destroys expired previews (namespace included) and leaves live ones', async () => {
    const h = makeDeps();
    const expiring = await createReady(h, 53);
    const live = await createReady(h, 54);
    await expirePreview(expiring.id, h);
    await runPreviewReaperCycle(h.deps);
    const remaining = await listPreviewEnvironments();
    assert.equal(remaining.find((p) => p.id === expiring.id), undefined);
    assert.ok(remaining.find((p) => p.id === live.id));
    assert.equal(h.kubectl.namespaces.has(expiring.namespace), false);
    assert.equal(h.kubectl.namespaces.has(live.namespace), true);
  });

  it('cleanup purges expired previews and reports only the purged ones', async () => {
    const h = makeDeps();
    const expiring = await createReady(h, 55);
    await createReady(h, 56);
    await expirePreview(expiring.id, h);
    const result = await cleanupExpiredPreviews(h.deps);
    assert.deepEqual(result, { purgedCount: 1, purgedIds: [expiring.id] });
  });

  it('cleanup with no cluster throws cluster_unavailable', async () => {
    const h = makeDeps();
    h.connected = false;
    await assert.rejects(
      () => cleanupExpiredPreviews(h.deps),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });

  it('extending an expired preview re-verifies instead of claiming ready', async () => {
    const h = makeDeps();
    const preview = await createReady(h, 57);
    await expirePreview(preview.id, h);
    const updated = await extendPreviewTtl(preview.id, 60, h.deps);
    assert.ok(updated);
    assert.equal(updated.status, 'provisioning');
    assert.equal(updated.provisioningStage, 'verifying');
  });
});
