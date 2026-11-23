/**
 * Ephemeral PR preview environments, wired to the real cluster
 * (studio wiring, Batch C).
 *
 * A preview is a real, isolated copy of a catalog app in its own
 * namespace: the namespace is created with PSS labels, the app is
 * deployed into it through the real catalog deployer (ArgoCD
 * Application with a preview-scoped name, or a local Helm chart), a
 * dedicated Ingress is created for the preview host, and the record
 * only reports `ready` after the namespace exists AND a workload is
 * Ready AND the Ingress exists — all three verified against the live
 * cluster, never assumed. With no cluster every mutating call throws
 * `ClusterUnavailableError` (503 at the route); nothing is seeded and
 * nothing is fabricated.
 *
 * The store is process-local (as before): records live for the server
 * process lifetime. A restart loses the records — the namespaces
 * linger on the cluster until deleted by hand. A future slice can
 * reconcile by listing `preview-pr-*` namespaces.
 */
import { K8sClient } from './k8s.js';
import { ClusterUnavailableError } from './errors.js';
import { ensureNamespaceWithSecurity } from './namespaces.js';
import {
  deployCatalogApp,
  listCatalogApps,
  type CatalogAppMeta,
  type DeployEngine,
} from './app-deployer.js';
import { loadProjectConfig, findProjectRoot } from './config.js';
import { processManager, type CommandWaitResult } from './executor.js';
import { getWaffleExecutionEnv } from './waffle/shared.js';
import { assertK8sLabel } from './exec-argv.js';
import { requireFound } from './studio-store.js';
import { stringifyYaml } from './yaml.js';

export interface PreviewEnvironment {
  id: string;
  prNumber: number;
  branch: string;
  appName: string;
  namespace: string;
  subdomain: string;
  previewUrl: string;
  status: 'provisioning' | 'ready' | 'expired' | 'terminating';
  createdAt: string;
  expiresAt: string;
  ttlMinutes: number;
  remainingMinutes: number;
  commitSha: string;
  imageTag: string;
  replicas: number;
  resourceLimits: {
    cpu: string;
    memory: string;
  };
  /**
   * Where a provisioning preview currently is: namespace creation,
   * app deploy, Ingress creation, or awaiting readiness verification.
   * Absent once the preview is ready (or expired).
   */
  provisioningStage?: 'namespace' | 'deploy' | 'ingress' | 'verifying';
  /** Last provisioning failure, if the create/deploy step failed. */
  provisionError?: string;
  /** Which deploy engine created this preview (needed by destroy). */
  deployEngine?: DeployEngine;
  /** Preview-scoped ArgoCD Application name (argocd engine only). */
  applicationName?: string;
}

export interface CreatePreviewParams {
  prNumber: number;
  branch: string;
  appName: string;
  ttlMinutes?: number;
  commitSha?: string;
  imageTag?: string;
}

/** Re-creating a live preview of the same PR + app is a conflict (409). */
export class PreviewConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewConflictError';
  }
}

/** The requested app is not a deployable catalog app (404). */
export class PreviewAppNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewAppNotFoundError';
  }
}

/**
 * Client-layer seam (F3 ebpf precedent): production defaults are the
 * real helpers; tests pass stubs. Nothing here shells out directly —
 * kubectl goes through `runKubectl`, which defaults to the hardened
 * `processManager.runCommandAndWait`.
 */
export interface PreviewDeps {
  projectRoot?: string;
  ensureNamespace?: typeof ensureNamespaceWithSecurity;
  deployApp?: typeof deployCatalogApp;
  runKubectl?: (
    args: string[],
    opts?: { input?: string; persist?: boolean; timeoutMs?: number }
  ) => Promise<CommandWaitResult>;
  getTelemetry?: () => Promise<{ isConnected: boolean }>;
  listCatalog?: (projectRoot: string) => CatalogAppMeta[];
  /** Ingress class for the preview Ingress (default: project config). */
  ingressClass?: string;
  /** Start the background reaper on first use (default true). */
  startReaper?: boolean;
}

export interface PreviewReadiness {
  namespaceExists: boolean;
  deploymentReady: boolean;
  ingressExists: boolean;
  ready: boolean;
  /** Observed replicas / image of the first ready workload, if any. */
  replicas?: number;
  imageTag?: string;
}

// Process-local registry. Starts EMPTY: the two seeded "ready"
// previews were fabrications (Batch C, C1) and are gone.
let previewsStore: PreviewEnvironment[] = [];

/** How often the background reaper sweeps (provisioning promotion + TTL expiry). */
export const PREVIEW_REAPER_INTERVAL_MS = 30_000;

let reaperHandle: ReturnType<typeof setInterval> | null = null;
let reaperDeps: PreviewDeps | null = null;

function resolveDeps(deps?: PreviewDeps): Required<
  Pick<PreviewDeps, 'ensureNamespace' | 'deployApp' | 'runKubectl' | 'getTelemetry' | 'listCatalog'>
> & { projectRoot: string; ingressClass?: string; startReaper: boolean } {
  const projectRoot = deps?.projectRoot ?? findProjectRoot();
  return {
    projectRoot,
    ensureNamespace: deps?.ensureNamespace ?? ensureNamespaceWithSecurity,
    deployApp: deps?.deployApp ?? deployCatalogApp,
    runKubectl:
      deps?.runKubectl ??
      ((args: string[], opts?: { input?: string; persist?: boolean; timeoutMs?: number }) =>
        processManager.runCommandAndWait('kubectl', args, {
          cwd: projectRoot,
          env: getWaffleExecutionEnv(),
          input: opts?.input,
          persist: opts?.persist,
          timeoutMs: opts?.timeoutMs,
        })),
    getTelemetry: deps?.getTelemetry ?? (async () => new K8sClient().getTelemetry()),
    listCatalog: deps?.listCatalog ?? listCatalogApps,
    ingressClass: deps?.ingressClass,
    startReaper: deps?.startReaper ?? true,
  };
}

/** Probe the cached telemetry; throw when there is no cluster. */
async function requireCluster(
  getTelemetry: () => Promise<{ isConnected: boolean }>
): Promise<void> {
  const telemetry = await getTelemetry();
  if (!telemetry.isConnected) {
    throw new ClusterUnavailableError();
  }
}

/** Kubernetes names are DNS-1123 labels, max 63 chars. */
function previewScopedName(prefix: string, prNumber: number, appSlug: string): string {
  const raw = `${prefix}-${prNumber}-${appSlug}`.toLowerCase();
  const truncated = raw.slice(0, 63).replace(/-+$/, '');
  return assertK8sLabel(truncated, 'preview name');
}

function resolveIngressClass(projectRoot: string, override?: string): string {
  if (override) return override;
  try {
    const config = loadProjectConfig(projectRoot);
    return config.cluster.ingress || config.raw.THIS_CLUSTER_INGRESS || 'traefik';
  } catch {
    return 'traefik';
  }
}

function parseKubectlJson(stdout: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('kubectl returned unexpected JSON');
  }
  return parsed as Record<string, unknown>;
}

function itemsOf(doc: Record<string, unknown>): Record<string, unknown>[] {
  const items = doc.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (i): i is Record<string, unknown> => !!i && typeof i === 'object' && !Array.isArray(i)
  );
}

function nested(doc: Record<string, unknown>, ...keys: string[]): unknown {
  let cur: unknown = doc;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Verify a preview against the live cluster: the namespace exists, a
 * workload (Deployment or StatefulSet) is Ready, and an Ingress
 * exists for the preview host. All three must hold before the record
 * may report `ready`. Returns the observed replicas/image so the
 * caller can record real values instead of the old hardcoded ones.
 */
export async function verifyPreviewReady(
  projectRoot: string,
  preview: PreviewEnvironment,
  deps?: PreviewDeps
): Promise<PreviewReadiness> {
  const d = resolveDeps({ ...deps, projectRoot });
  const result: PreviewReadiness = {
    namespaceExists: false,
    deploymentReady: false,
    ingressExists: false,
    ready: false,
  };

  const ns = await d.runKubectl(['get', 'namespace', preview.namespace, '-o', 'json'], {
    persist: false,
    timeoutMs: 30_000,
  });
  result.namespaceExists = ns.code === 0;
  if (!result.namespaceExists) return result;

  const workloads = await d.runKubectl(
    ['get', 'deploy,sts', '-n', preview.namespace, '-o', 'json'],
    { persist: false, timeoutMs: 30_000 }
  );
  if (workloads.code === 0) {
    for (const item of itemsOf(parseKubectlJson(workloads.stdout))) {
      const kind = item.kind;
      if (kind !== 'Deployment' && kind !== 'StatefulSet') continue;
      const desiredRaw = nested(item, 'spec', 'replicas');
      const desired = typeof desiredRaw === 'number' ? desiredRaw : 1;
      const readyRaw =
        kind === 'Deployment'
          ? nested(item, 'status', 'availableReplicas')
          : nested(item, 'status', 'readyReplicas');
      const ready = typeof readyRaw === 'number' ? readyRaw : 0;
      if (desired >= 1 && ready >= desired) {
        result.deploymentReady = true;
        result.replicas = desired;
        const containers = nested(item, 'spec', 'template', 'spec', 'containers');
        if (Array.isArray(containers) && containers.length > 0) {
          const first = containers[0];
          if (first && typeof first === 'object' && !Array.isArray(first)) {
            const image = (first as Record<string, unknown>).image;
            if (typeof image === 'string' && image) result.imageTag = image;
          }
        }
        break;
      }
    }
  }

  const ingresses = await d.runKubectl(['get', 'ingress', '-n', preview.namespace, '-o', 'json'], {
    persist: false,
    timeoutMs: 30_000,
  });
  if (ingresses.code === 0) {
    for (const item of itemsOf(parseKubectlJson(ingresses.stdout))) {
      const rules = nested(item, 'spec', 'rules');
      if (!Array.isArray(rules)) continue;
      for (const rule of rules) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
        if ((rule as Record<string, unknown>).host === preview.subdomain) {
          result.ingressExists = true;
          break;
        }
      }
      if (result.ingressExists) break;
    }
  }

  result.ready =
    result.namespaceExists && result.deploymentReady && result.ingressExists;
  return result;
}

function refreshExpiry(preview: PreviewEnvironment, nowMs: number): PreviewEnvironment {
  const expires = new Date(preview.expiresAt).getTime();
  const remaining = Math.max(0, Math.round((expires - nowMs) / 60000));
  const status = remaining === 0 && preview.status !== 'terminating' ? 'expired' : preview.status;
  return { ...preview, remainingMinutes: remaining, status };
}

export async function listPreviewEnvironments(): Promise<PreviewEnvironment[]> {
  const now = Date.now();
  previewsStore = previewsStore.map((p) => refreshExpiry(p, now));
  return [...previewsStore];
}

/** Pick the Service the preview Ingress should route to. */
function pickPreviewService(
  servicesDoc: Record<string, unknown>,
  appName: string
): { name: string; port: number } | null {
  const items = itemsOf(servicesDoc);
  const withPorts = items.filter((svc) => {
    const ports = nested(svc, 'spec', 'ports');
    return Array.isArray(ports) && ports.length > 0;
  });
  if (withPorts.length === 0) return null;
  const nameOf = (svc: Record<string, unknown>): string => {
    const name = nested(svc, 'metadata', 'name');
    return typeof name === 'string' ? name : '';
  };
  const preferred =
    withPorts.find((svc) => nameOf(svc) === appName) ??
    withPorts.find((svc) => nameOf(svc).includes(appName)) ??
    withPorts[0];
  const ports = nested(preferred, 'spec', 'ports') as Array<Record<string, unknown>>;
  const portRaw = ports[0]?.port;
  const port = typeof portRaw === 'number' ? portRaw : 0;
  if (!nameOf(preferred) || port <= 0) return null;
  return { name: nameOf(preferred), port };
}

export async function createPreviewEnvironment(
  params: CreatePreviewParams,
  deps?: PreviewDeps
): Promise<PreviewEnvironment> {
  const d = resolveDeps(deps);
  const { projectRoot } = d;

  // No cluster, no preview: the old code returned `ready` with a
  // fabricated sslip.io URL. That is exactly what Batch C forbids.
  await requireCluster(d.getTelemetry);

  // The app must be a real, deployable catalog app. Unknown or
  // non-deployable names 404 instead of "deploying" nothing.
  const catalog = d.listCatalog(projectRoot);
  const app = catalog.find((a) => a.appId === params.appName);
  if (!app || (!app.hasArgoManifest && !app.hasLocalChart)) {
    throw new PreviewAppNotFoundError(
      `Application '${params.appName}' is not a deployable catalog app`
    );
  }
  const engine: DeployEngine = app.hasArgoManifest ? 'argocd' : 'helm';

  const ttl = params.ttlMinutes || 120;
  const now = new Date();
  const expires = new Date(now.getTime() + ttl * 60 * 1000);
  const cleanApp = params.appName.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const id = `prev-pr-${params.prNumber}-${cleanApp}`;
  const namespace = previewScopedName('preview-pr', params.prNumber, cleanApp);
  const subdomain = `pr-${params.prNumber}-${cleanApp}.127.0.0.1.sslip.io`;

  // Re-create of the same PR + app used to silently replace the live
  // preview. A live record is a conflict; an expired one may be
  // re-created (its namespace is re-ensured and the app redeployed).
  const existing = previewsStore.find((p) => p.id === id);
  if (existing && refreshExpiry(existing, Date.now()).status !== 'expired') {
    throw new PreviewConflictError(
      `Preview environment ${id} already exists (status: ${existing.status})`
    );
  }
  previewsStore = previewsStore.filter((p) => p.id !== id);

  const applicationName = namespace;
  const record: PreviewEnvironment = {
    id,
    prNumber: params.prNumber,
    branch: params.branch,
    appName: params.appName,
    namespace,
    subdomain,
    // Plain http: the preview Ingress carries no TLS. The old code
    // claimed https:// for an Ingress that never existed.
    previewUrl: `http://${subdomain}`,
    status: 'provisioning',
    provisioningStage: 'namespace',
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    ttlMinutes: ttl,
    remainingMinutes: ttl,
    // Unknown until observed: the old 'c0ffee7' / `pr-N-latest`
    // defaults were fabricated values.
    commitSha: params.commitSha || '',
    imageTag: params.imageTag || '',
    replicas: 0,
    resourceLimits: { cpu: '', memory: '' },
    deployEngine: engine,
    applicationName,
  };

  // Best-effort cleanup of a half-created preview: a failed deploy
  // must not leak its namespace behind.
  const cleanupPartial = async (): Promise<void> => {
    try {
      await d.runKubectl(['delete', 'namespace', namespace, '--ignore-not-found'], {
        timeoutMs: 60_000,
      });
    } catch {
      // Best effort only — the create error below is the real signal.
    }
  };

  try {
    await d.ensureNamespace(projectRoot, namespace, {
      enforce: 'baseline',
      audit: 'restricted',
      warn: 'restricted',
      category: 'app',
    });
    record.provisioningStage = 'deploy';

    const deployResult = await d.deployApp(projectRoot, params.appName, {
      engine,
      namespace,
      envOverrides: { THIS_NAMESPACE: namespace },
      applicationName,
      skipInitDirs: true,
      ...(engine === 'helm' ? { wait: false } : {}),
    });
    if (!deployResult.success) {
      throw new Error(
        `Failed to deploy application '${params.appName}': ${deployResult.error ?? deployResult.message}`
      );
    }
    record.provisioningStage = 'ingress';

    // Discover the deployed Service and wire a dedicated preview
    // Ingress to it. The host only becomes a real URL once this
    // Ingress object exists on the cluster.
    const services = await d.runKubectl(['get', 'svc', '-n', namespace, '-o', 'json'], {
      timeoutMs: 30_000,
    });
    if (services.code !== 0) {
      throw new Error(
        `Failed to list Services in namespace ${namespace}: ${services.stderr.trim() || `exit ${services.code}`}`
      );
    }
    const target = pickPreviewService(parseKubectlJson(services.stdout), params.appName);
    if (!target) {
      throw new Error(
        `No Service with ports found in namespace ${namespace} after deploying '${params.appName}'`
      );
    }
    const ingressClass = resolveIngressClass(projectRoot, d.ingressClass);
    const ingressManifest = stringifyYaml({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: 'preview-ingress',
        namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'vow-previews',
          'vow.io/preview-id': id,
        },
      },
      spec: {
        ingressClassName: ingressClass,
        rules: [
          {
            host: subdomain,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: {
                    service: { name: target.name, port: { number: target.port } },
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const applied = await d.runKubectl(['apply', '-f', '-'], {
      input: ingressManifest,
      timeoutMs: 60_000,
    });
    if (applied.code !== 0) {
      throw new Error(
        `Failed to apply preview Ingress: ${applied.stderr.trim() || `exit ${applied.code}`}`
      );
    }
    record.provisioningStage = 'verifying';
  } catch (err) {
    await cleanupPartial();
    if (err instanceof Error) {
      record.provisionError = err.message;
    }
    throw err;
  }

  previewsStore.unshift(record);

  // One verification pass now: in the common case the app is still
  // coming up and the record stays `provisioning`; if everything is
  // already up (e.g. a fast Helm install), report `ready` honestly.
  const readiness = await verifyPreviewReady(projectRoot, record, deps);
  if (readiness.ready) {
    record.status = 'ready';
    record.provisioningStage = undefined;
    record.replicas = readiness.replicas ?? record.replicas;
    if (readiness.imageTag) record.imageTag = readiness.imageTag;
  }

  if (d.startReaper) ensurePreviewReaperStarted(deps);
  return { ...record };
}

/** Delete cluster resources for a preview record. True when gone. */
async function deletePreviewClusterResources(
  preview: PreviewEnvironment,
  d: ReturnType<typeof resolveDeps>
): Promise<boolean> {
  // The ArgoCD Application CR lives in the argocd namespace, NOT the
  // preview namespace — deleting the namespace alone would leave it
  // behind, and ArgoCD would recreate the namespace on next sync.
  if (preview.deployEngine === 'argocd' && preview.applicationName) {
    const deleted = await d.runKubectl(
      ['delete', 'application', preview.applicationName, '-n', 'argocd', '--ignore-not-found'],
      { timeoutMs: 60_000 }
    );
    if (deleted.code !== 0) {
      const stderr = deleted.stderr.toLowerCase();
      const alreadyGone =
        stderr.includes('not found') ||
        stderr.includes('no resources found') ||
        stderr.includes("doesn't have a resource type") ||
        stderr.includes('does not have a resource type');
      if (!alreadyGone) return false;
    }
  }

  // Helm releases live inside the preview namespace, so deleting the
  // namespace removes them too — no separate uninstall needed.
  const removed = await d.runKubectl(
    ['delete', 'namespace', preview.namespace, '--wait', '--timeout=120s'],
    { timeoutMs: 150_000 }
  );
  if (removed.code !== 0) {
    const stderr = removed.stderr.toLowerCase();
    if (!stderr.includes('not found')) return false;
  }

  // Confirm before reporting success: a delete that "succeeded" while
  // the namespace still exists (finalizers, terminating) is a lie.
  const gone = await d.runKubectl(['get', 'namespace', preview.namespace, '-o', 'json'], {
    persist: false,
    timeoutMs: 30_000,
  });
  return gone.code !== 0;
}

export async function destroyPreviewEnvironment(
  id: string,
  deps?: PreviewDeps
): Promise<{ success: boolean; message: string }> {
  const d = resolveDeps(deps);
  const preview = requireFound(previewsStore, (p) => p.id === id);
  if (!preview) {
    return { success: false, message: `Preview environment ${id} not found` };
  }

  await requireCluster(d.getTelemetry);

  const deleted = await deletePreviewClusterResources(preview, d);
  if (!deleted) {
    return {
      success: false,
      message: `Failed to delete preview namespace ${preview.namespace}; preview ${id} kept`,
    };
  }
  previewsStore = previewsStore.filter((p) => p.id !== id);
  return {
    success: true,
    message: `Purged preview namespace ${preview.namespace} and associated ingress routes.`,
  };
}

export async function extendPreviewTtl(
  id: string,
  additionalMinutes: number = 60,
  deps?: PreviewDeps
): Promise<PreviewEnvironment | null> {
  const preview = requireFound(previewsStore, (p) => p.id === id);
  if (!preview) return null;

  const currentExpires = new Date(preview.expiresAt).getTime();
  const newExpires = new Date(Math.max(Date.now(), currentExpires) + additionalMinutes * 60 * 1000);

  preview.expiresAt = newExpires.toISOString();
  preview.ttlMinutes += additionalMinutes;
  preview.remainingMinutes = Math.max(0, Math.round((newExpires.getTime() - Date.now()) / 60000));
  if (preview.status === 'expired') {
    // The namespace may still exist, but the deployment's health is
    // unverified after expiry — re-verify instead of claiming `ready`.
    preview.status = 'provisioning';
    preview.provisioningStage = 'verifying';
    if (deps?.startReaper ?? true) ensurePreviewReaperStarted(deps);
  }

  return { ...preview };
}

export async function cleanupExpiredPreviews(
  deps?: PreviewDeps
): Promise<{ purgedCount: number; purgedIds: string[] }> {
  const d = resolveDeps(deps);
  await requireCluster(d.getTelemetry);

  await listPreviewEnvironments();
  const expired = previewsStore.filter((p) => p.status === 'expired' || p.remainingMinutes <= 0);
  const purgedIds: string[] = [];
  for (const preview of expired) {
    // Reuse destroy: the namespace must actually go away, not just
    // the record. Failures stay expired for the reaper to retry.
    const result = await destroyPreviewEnvironment(preview.id, deps);
    if (result.success) purgedIds.push(preview.id);
  }
  return { purgedCount: purgedIds.length, purgedIds };
}

/**
 * One reaper tick: promote provisioning previews whose cluster state
 * is now Ready, and destroy expired previews (namespace included).
 * Exported for tests; the interval calls it with the stored deps.
 * Never throws — a tick that fails (cluster down, kubectl error)
 * leaves records alone for the next tick.
 */
export async function runPreviewReaperCycle(deps?: PreviewDeps): Promise<void> {
  const d = resolveDeps(deps);
  const now = Date.now();
  const snapshot = previewsStore.map((p) => refreshExpiry(p, now));

  for (const preview of snapshot) {
    try {
      if (preview.status === 'provisioning') {
        const readiness = await verifyPreviewReady(d.projectRoot, preview, deps);
        if (readiness.ready) {
          const stored = previewsStore.find((p) => p.id === preview.id);
          if (stored && stored.status === 'provisioning') {
            stored.status = 'ready';
            stored.provisioningStage = undefined;
            stored.replicas = readiness.replicas ?? stored.replicas;
            if (readiness.imageTag) stored.imageTag = readiness.imageTag;
          }
        }
      } else if (preview.status === 'expired') {
        await destroyPreviewEnvironment(preview.id, deps);
      }
    } catch {
      // Next tick retries; a down cluster must not kill the loop.
    }
  }
}

/**
 * Start the background reaper (watcher `setInterval` pattern: a
 * re-entrancy guard, errors swallowed per tick, `unref()` so the
 * timer never holds the process open). Idempotent; first caller wins
 * the deps. Started lazily from the public functions so importing
 * this module (e.g. in tests) has no side effects.
 */
export function startPreviewReaper(deps?: PreviewDeps): void {
  if (reaperHandle) return;
  reaperDeps = deps ?? null;
  let ticking = false;
  reaperHandle = setInterval(() => {
    if (ticking) return;
    ticking = true;
    runPreviewReaperCycle(reaperDeps ?? undefined)
      .catch(() => {
        // Swallowed per tick; the next tick retries.
      })
      .finally(() => {
        ticking = false;
      });
  }, PREVIEW_REAPER_INTERVAL_MS);
  reaperHandle.unref?.();
}

export function ensurePreviewReaperStarted(deps?: PreviewDeps): void {
  startPreviewReaper(deps);
}

/** Stop the background reaper (tests; graceful shutdown). */
export function stopPreviewReaper(): void {
  if (reaperHandle) {
    clearInterval(reaperHandle);
    reaperHandle = null;
    reaperDeps = null;
  }
}
