/**
 * Fleet commander, wired to real systems (studio wiring, Phase 1).
 *
 * The fleet is the kubeconfig: one `FleetCluster` record per kubeconfig
 * context, built from a per-context `getTelemetry()` probe (node/pod
 * counts, kubelet version, summed node capacity, cluster server) plus a
 * per-context ArgoCD application listing for the sync status. EKS/GKE
 * entries appear only when those contexts exist in the kubeconfig —
 * nothing is seeded. Fields telemetry cannot observe are derived from
 * real observables and labelled as such (see `deriveProvider` /
 * `deriveEnvironment`); nothing is invented.
 *
 * - Unknown cluster id → `{success:false}` (C4, via `requireFound`).
 * - No kubeconfig contexts at all → throws `ClusterUnavailableError`
 *   (the Phase 0 F1 no-cluster contract; routes map it to 503).
 *   A context whose API is unreachable is a real record with status
 *   OFFLINE, not an error.
 * - `switchClusterContext` performs a real `kubectl config use-context`
 *   and only reports success after a `getTelemetry()` probe answers
 *   under the new context.
 * - `broadcastApplication` switches to each target in turn, runs a real
 *   ArgoCD/Flux sync (runner from `config.cluster.cdRunner`, mirroring
 *   the apps/[id] route convention), and aggregates per-cluster
 *   outcomes — partial failure is reported per cluster, never a blanket
 *   success. The operator's original context is restored afterwards.
 */
import { ArgoManager } from './argocd.js';
import { ClusterUnavailableError } from './errors.js';
import { loadProjectConfig } from './config.js';
import { processManager, type CommandWaitResult } from './executor.js';
import { FluxManager } from './flux.js';
import { K8sClient, type ArgoAppStatus, type ClusterTelemetry } from './k8s.js';
import { requireFound } from './studio-store.js';

export interface FleetCluster {
  id: string;
  name: string;
  environment: 'local' | 'dev' | 'staging' | 'production';
  provider: 'kind' | 'k3d' | 'k3s' | 'eks' | 'gke' | 'aks' | 'other';
  k8sVersion: string;
  nodeCount: number;
  podCount: number;
  cpuCapacityCores: number;
  memoryCapacityGb: number;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  isCurrentContext: boolean;
  location: string;
  argocdSyncStatus: 'Synced' | 'OutOfSync' | 'Progressing' | 'Unknown';
}

export interface BroadcastClusterResult {
  clusterId: string;
  clusterName: string;
  success: boolean;
  message: string;
}

export interface BroadcastResult {
  success: boolean;
  deployedClusters: string[];
  failedClusters: string[];
  results: BroadcastClusterResult[];
  message: string;
}

export type FleetRunner = 'argocd' | 'flux';

/**
 * Minimal K8s surface fleet needs. A real `K8sClient` satisfies it
 * structurally; tests inject a stub. `withContext` is the in-memory
 * context switch (no kubeconfig file write) the per-context probes use.
 */
export interface FleetK8sClient {
  getContexts(): { current: string; contexts: string[] };
  withContext<T>(contextName: string, fn: (client: FleetK8sClient) => Promise<T>): Promise<T>;
  getTelemetry(): Promise<ClusterTelemetry>;
  getArgoApplications(): Promise<{ installed: boolean; applications: ArgoAppStatus[] }>;
  switchContext(contextName: string): Promise<void>;
}

export interface FleetDeps {
  client?: FleetK8sClient;
  projectRoot?: string;
  /** Override the GitOps runner (default: config.cluster.cdRunner). */
  cdRunner?: string;
  /** Override the per-cluster sync (default: real Argo/Flux syncApp, awaited). */
  syncApp?: (runner: FleetRunner, appId: string, projectRoot: string) => Promise<CommandWaitResult>;
}

async function defaultSyncApp(
  runner: FleetRunner,
  appId: string,
  projectRoot: string
): Promise<CommandWaitResult> {
  if (runner === 'flux') {
    return processManager.waitForTask(new FluxManager(projectRoot).syncApp(appId));
  }
  return processManager.waitForTask(new ArgoManager(projectRoot).syncApp(appId));
}

/**
 * Runner selection mirrors the apps/[id] route convention: only an
 * exact 'flux' selects Flux; 'argocd' and 'both' both sync through
 * ArgoCD here (broadcast has no per-request runner override).
 */
function resolveRunner(deps: FleetDeps, projectRoot: string): FleetRunner {
  const configured = (
    deps.cdRunner ?? loadProjectConfig(projectRoot).cluster.cdRunner ?? 'argocd'
  ).toLowerCase();
  return configured === 'flux' ? 'flux' : 'argocd';
}

/**
 * Provider is derived from the context name + the telemetry-detected
 * platform. 'k3s' and 'other' are honest values for distributions the
 * old contract had no member for — a k3s context is neither kind nor
 * a cloud provider, and mapping it to one would be a lie.
 */
function deriveProvider(
  context: string,
  platform: ClusterTelemetry['detectedPlatform']
): FleetCluster['provider'] {
  const lower = context.toLowerCase();
  if (lower.startsWith('kind-') || platform === 'kind') return 'kind';
  if (lower.startsWith('k3d-') || platform === 'k3d') return 'k3d';
  if (platform === 'k3s') return 'k3s';
  if (lower.startsWith('arn:aws:eks:') || lower.includes('eks')) return 'eks';
  if (lower.startsWith('gke_') || lower.includes('gke')) return 'gke';
  if (lower.includes('aks')) return 'aks';
  return 'other';
}

/**
 * Environment is a naming heuristic over real data, not observed state:
 * local distributions are always 'local'; cloud contexts are classified
 * by prod/staging markers in the context name, defaulting to 'dev'.
 */
function deriveEnvironment(
  provider: FleetCluster['provider'],
  context: string
): FleetCluster['environment'] {
  if (provider === 'kind' || provider === 'k3d' || provider === 'k3s') return 'local';
  const lower = context.toLowerCase();
  if (lower.includes('prod')) return 'production';
  if (lower.includes('staging') || lower.includes('stage')) return 'staging';
  return 'dev';
}

/** Cluster server URL reduced to its host for the location column. */
function serverHost(server: string): string {
  if (!server) return '';
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

function toFleetCluster(
  context: string,
  current: string,
  telemetry: ClusterTelemetry,
  argo: { installed: boolean; applications: ArgoAppStatus[] }
): FleetCluster {
  const provider = deriveProvider(context, telemetry.detectedPlatform);
  const status: FleetCluster['status'] = !telemetry.isConnected
    ? 'OFFLINE'
    : telemetry.nodes.some((n) => n.status !== 'Ready')
      ? 'DEGRADED'
      : 'ONLINE';
  // Sync status is read from the cluster's own ArgoCD applications.
  // 'Unknown' is the honest value when ArgoCD is not installed — there
  // is no sync state to report, and 'OutOfSync' would be a lie.
  const argocdSyncStatus: FleetCluster['argocdSyncStatus'] = !argo.installed
    ? 'Unknown'
    : argo.applications.some((a) => a.syncStatus === 'OutOfSync')
      ? 'OutOfSync'
      : 'Synced';
  return {
    id: context,
    name: telemetry.detectedClusterName || context,
    environment: deriveEnvironment(provider, context),
    provider,
    k8sVersion: telemetry.k8sVersion,
    nodeCount: telemetry.nodeCount,
    podCount: telemetry.podCount,
    cpuCapacityCores: telemetry.cpuCapacityCores,
    memoryCapacityGb: telemetry.memoryCapacityGb,
    status,
    isCurrentContext: context === current,
    location: serverHost(telemetry.server),
    argocdSyncStatus,
  };
}

export async function listFleetClusters(deps: FleetDeps = {}): Promise<FleetCluster[]> {
  const client = deps.client ?? new K8sClient();
  const { current, contexts } = client.getContexts();
  if (contexts.length === 0) {
    throw new ClusterUnavailableError(
      'No Kubernetes contexts are configured (no kubeconfig found). Fleet has no clusters to list.'
    );
  }
  const clusters: FleetCluster[] = [];
  for (const context of contexts) {
    const cluster = await client.withContext(context, async (c) => {
      const telemetry = await c.getTelemetry();
      const argo = await c.getArgoApplications();
      return toFleetCluster(context, current, telemetry, argo);
    });
    clusters.push(cluster);
  }
  return clusters;
}

export async function switchClusterContext(
  clusterId: string,
  deps: FleetDeps = {}
): Promise<{ success: boolean; activeCluster: FleetCluster | null; message: string }> {
  const client = deps.client ?? new K8sClient();
  const clusters = await listFleetClusters(deps);
  const target = requireFound(clusters, (c) => c.id === clusterId);
  if (!target) {
    return { success: false, activeCluster: null, message: `Cluster ${clusterId} not found.` };
  }

  // Real switch: rewrites the kubeconfig's current-context.
  await client.switchContext(clusterId);
  // Verify: the switch only counts if the API answers under the new
  // context. switchContext clears the telemetry cache, so this is a
  // fresh probe, not the pre-switch entry.
  const telemetry = await client.getTelemetry();
  if (!telemetry.isConnected) {
    return {
      success: false,
      activeCluster: target,
      message: `Switched kubectl context to [${target.name}] but the cluster API is not reachable; the switch is unverified.`,
    };
  }
  const refreshed = await listFleetClusters(deps);
  const active = requireFound(refreshed, (c) => c.id === clusterId) ?? target;
  return {
    success: true,
    activeCluster: active,
    message: `Switched active kubectl context to [${active.name}] (${active.provider.toUpperCase()}).`,
  };
}

export async function broadcastApplication(
  appId: string,
  targetClusterIds: string[],
  deps: FleetDeps = {}
): Promise<BroadcastResult> {
  const client = deps.client ?? new K8sClient();
  const clusters = await listFleetClusters(deps);
  const uniqueTargets = [...new Set(targetClusterIds)];
  const targets = uniqueTargets
    .map((id) => requireFound(clusters, (c) => c.id === id))
    .filter((c): c is FleetCluster => c !== null);
  const unknownIds = uniqueTargets.filter((id) => !clusters.some((c) => c.id === id));
  // C4: broadcasting to zero matching clusters is a miss, not a success.
  if (targets.length === 0) {
    return {
      success: false,
      deployedClusters: [],
      failedClusters: [],
      results: [],
      message: `No matching fleet clusters found for broadcast of application [${appId}].`,
    };
  }

  const projectRoot = deps.projectRoot ?? process.cwd();
  const runner = resolveRunner(deps, projectRoot);
  const sync = deps.syncApp ?? defaultSyncApp;
  const originalContext = client.getContexts().current;

  const results: BroadcastClusterResult[] = [];
  try {
    for (const target of targets) {
      try {
        await client.switchContext(target.id);
        const telemetry = await client.getTelemetry();
        if (!telemetry.isConnected) {
          results.push({
            clusterId: target.id,
            clusterName: target.name,
            success: false,
            message: 'Cluster API is not reachable; sync skipped.',
          });
          continue;
        }
        const outcome = await sync(runner, appId, projectRoot);
        if (outcome.code === 0) {
          results.push({
            clusterId: target.id,
            clusterName: target.name,
            success: true,
            message: `Synced ${appId} via ${runner}.`,
          });
        } else {
          // No raw stderr in the message (B13): the full output lives
          // in the task record, identified here by task id.
          results.push({
            clusterId: target.id,
            clusterName: target.name,
            success: false,
            message: `${runner} sync failed (exit ${outcome.code}, task ${outcome.taskId}).`,
          });
        }
      } catch (err) {
        // Per-cluster isolation: one target's failure (switch, probe,
        // sync spawn) must not abort the remaining targets.
        results.push({
          clusterId: target.id,
          clusterName: target.name,
          success: false,
          message: err instanceof Error ? err.message : 'Sync failed',
        });
      }
    }
  } finally {
    // A broadcast must not silently move the operator's active context
    // to the last target: restore it, best-effort.
    if (originalContext) {
      try {
        await client.switchContext(originalContext);
      } catch {
        // Outcomes are already recorded; a failed restore is visible
        // on the next fleet list (isCurrentContext).
      }
    }
  }

  const deployed = results.filter((r) => r.success).map((r) => r.clusterName);
  const failed = results.filter((r) => !r.success).map((r) => r.clusterName);
  const success = failed.length === 0;
  const unknownNote =
    unknownIds.length > 0 ? ` Unknown cluster ids ignored: ${unknownIds.join(', ')}.` : '';
  return {
    success,
    deployedClusters: deployed,
    failedClusters: failed,
    results,
    message: success
      ? `Broadcasted application [${appId}] to ${deployed.length} fleet cluster(s) via ${runner}.${unknownNote}`
      : `Broadcast of [${appId}] ${deployed.length > 0 ? 'partially failed' : 'failed'}: ${deployed.length} synced, ${failed.length} failed (${failed.join(', ')}).${unknownNote}`,
  };
}
