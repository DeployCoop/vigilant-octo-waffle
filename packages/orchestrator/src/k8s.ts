import * as fs from 'node:fs';
import * as k8s from '@kubernetes/client-node';

import { execFileAsync } from './exec-argv.js';

export interface ClusterTelemetry {
  isConnected: boolean;
  context: string;
  detectedPlatform: 'kind' | 'k3d' | 'k3s' | 'unknown';
  detectedClusterName: string;
  nodeCount: number;
  podCount: number;
  namespaceCount: number;
  ingressCount: number;
  nodes: { name: string; status: string; roles: string[]; age: string; osImage?: string }[];
  namespaces: string[];
  ingresses: { name: string; namespace: string; host: string; class: string }[];
  /** Kubelet version of the first node that reports one ('' when none). */
  k8sVersion: string;
  /** Sum over nodes of status.capacity.cpu, in cores. */
  cpuCapacityCores: number;
  /** Sum over nodes of status.capacity.memory, in GiB (1 decimal). */
  memoryCapacityGb: number;
  /** Cluster server URL from the kubeconfig ('' when no current cluster). */
  server: string;
}

/** Parse a Kubernetes CPU quantity ("8", "4000m") to cores. */
function parseCpuCores(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (trimmed.endsWith('m')) {
    const n = parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(n) ? n / 1000 : 0;
  }
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a Kubernetes memory quantity ("16Gi", "16384000Ki", "17179869184")
 * to GiB. Binary (Ki/Mi/Gi/…) and decimal (K/M/G/…) suffixes both occur
 * on node capacity; an unparseable value contributes 0, never NaN.
 */
function parseMemoryGiB(value: string | undefined): number {
  if (!value) return 0;
  const match = /^([0-9.]+)(Ki|Mi|Gi|Ti|Pi|Ei|K|M|G|T|P|E)?$/.exec(value.trim());
  if (!match) return 0;
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return 0;
  const bytesPerUnit: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
    '': 1,
  };
  return (n * (bytesPerUnit[match[2] ?? ''] ?? 0)) / 1024 ** 3;
}

export interface PodInfo {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  node: string;
  ip: string;
  age: string;
  containers: { name: string; image: string; ready: boolean; restartCount: number }[];
}

export interface StorageInfo {
  storageClasses: {
    name: string;
    provisioner: string;
    reclaimPolicy: string;
    volumeBindingMode: string;
    isDefault: boolean;
  }[];
  persistentVolumes: {
    name: string;
    capacity: string;
    accessModes: string[];
    reclaimPolicy: string;
    status: string;
    claim: string;
    storageClass: string;
  }[];
  persistentVolumeClaims: {
    name: string;
    namespace: string;
    status: string;
    volume: string;
    capacity: string;
    accessModes: string[];
    storageClass: string;
  }[];
}

export interface ArgoAppStatus {
  name: string;
  namespace: string;
  healthStatus: 'Healthy' | 'Progressing' | 'Degraded' | 'Missing' | 'Suspended' | 'Unknown';
  healthMessage?: string;
  syncStatus: 'Synced' | 'OutOfSync' | 'Unknown';
  revision?: string;
  repoURL?: string;
  targetPath?: string;
  destinationServer?: string;
  destinationNamespace?: string;
}

/**
 * Secret metadata for the SecretOps audit (Batch C wiring).
 *
 * `dataKeys` carries KEY NAMES ONLY — never values. The list read must
 * not pull every secret value in the cluster into memory on every
 * audit; the full data map is available only through `getSecret`, which
 * the rotation flow uses to rebuild the secret manifest, and those
 * values are held in memory only for the apply — never logged,
 * persisted, or returned to callers.
 */
export interface SecretInfo {
  name: string;
  namespace: string;
  type: string;
  creationTimestamp?: string;
  annotations: Record<string, string>;
  labels: Record<string, string>;
  ownerKinds: string[];
  dataKeys: string[];
  resourceVersion?: string;
  immutable?: boolean;
}

/** Single-secret read for rotation: SecretInfo plus the full data map. */
export interface SecretDetail extends SecretInfo {
  data: Record<string, string>;
}

export interface ConfigMapInfo {
  name: string;
  namespace: string;
  /** String data values, scanned in memory for leaked credentials. */
  data: Record<string, string>;
}

export interface PodEnvVar {
  name: string;
  /** Literal value, when the env var sets one directly. */
  value?: string;
  /** secretKeyRef / configMapKeyRef source, when the value comes from a Secret/ConfigMap. */
  valueFromKind?: 'secretKeyRef' | 'configMapKeyRef';
  valueFromName?: string;
  valueFromKey?: string;
}

export interface PodContainerSpec {
  name: string;
  env: PodEnvVar[];
  envFromSecrets: string[];
  envFromConfigMaps: string[];
  args: string[];
}

export interface PodVolumeSpec {
  name: string;
  secretName?: string;
  configMapName?: string;
}

export interface PodSpecInfo {
  name: string;
  namespace: string;
  ownerKind?: string;
  ownerName?: string;
  containers: PodContainerSpec[];
  volumes: PodVolumeSpec[];
}

export interface ExternalSecretsStatus {
  installed: boolean;
  externalSecretCount: number;
  readyExternalSecretCount: number;
  storeReady: boolean;
}

// Wire shapes for the CustomObjectsApi calls below. The client returns
// untyped JSON for custom resources, so these interfaces describe the
// fields this module actually reads, and status strings are narrowed
// against the declared enums instead of being asserted.

interface CustomObjectCondition {
  type?: string;
  status?: string;
  message?: string;
  reason?: string;
}

interface CertManagerCertificate {
  metadata?: { name?: string; namespace?: string };
  spec?: {
    secretName?: string;
    dnsNames?: string[];
    issuerRef?: { name?: string };
  };
  status?: {
    conditions?: CustomObjectCondition[];
    renewalTime?: string;
    notAfter?: string;
  };
}

interface CertManagerClusterIssuer {
  metadata?: { name?: string };
  spec?: {
    ca?: unknown;
    acme?: unknown;
  };
  status?: {
    conditions?: CustomObjectCondition[];
  };
}

interface ArgoApplicationObject {
  metadata?: { name?: string; namespace?: string };
  spec?: {
    source?: { repoURL?: string; path?: string };
    destination?: { server?: string; namespace?: string };
  };
  status?: {
    health?: { status?: string; message?: string };
    sync?: { status?: string; revision?: string };
  };
}

interface ExternalSecretObject {
  metadata?: { name?: string; namespace?: string };
  status?: { conditions?: CustomObjectCondition[] };
}

interface ExternalSecretStoreObject {
  metadata?: { name?: string };
  status?: { conditions?: CustomObjectCondition[] };
}

/**
 * Map a V1Secret to SecretInfo: metadata plus data KEY NAMES ONLY.
 * Values are deliberately dropped here — the list read must never pull
 * secret values into memory.
 */
function secretInfoOf(s: k8s.V1Secret): SecretInfo {
  return {
    name: s.metadata?.name || '',
    namespace: s.metadata?.namespace || '',
    type: s.type || 'Opaque',
    creationTimestamp: s.metadata?.creationTimestamp?.toISOString(),
    annotations: { ...(s.metadata?.annotations || {}) },
    labels: { ...(s.metadata?.labels || {}) },
    ownerKinds: (s.metadata?.ownerReferences || [])
      .map((o) => o.kind)
      .filter((k): k is string => !!k),
    dataKeys: Object.keys(s.data || {}),
    resourceVersion: s.metadata?.resourceVersion,
    immutable: s.immutable,
  };
}

/**
 * The @kubernetes/client-node API client throws HttpError (with a
 * numeric `statusCode`) for HTTP failures. A 404 means "absent" for
 * single-object reads and "CRD not installed" for custom-object
 * lists; anything else is a real failure and must propagate.
 */
function isNotFoundError(err: unknown): boolean {
  if (err instanceof Error) {
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (statusCode === 404) return true;
    if (/not found/i.test(err.message)) return true;
  }
  return false;
}

// Argo CD's health/sync status vocabularies match the unions declared on
// ArgoAppStatus exactly; anything else on the wire narrows to 'Unknown'
// rather than leaking an out-of-contract value to callers.
function asArgoHealthStatus(value: string | undefined): ArgoAppStatus['healthStatus'] {
  switch (value) {
    case 'Healthy':
    case 'Progressing':
    case 'Degraded':
    case 'Missing':
    case 'Suspended':
      return value;
    default:
      return 'Unknown';
  }
}

function asArgoSyncStatus(value: string | undefined): ArgoAppStatus['syncStatus'] {
  switch (value) {
    case 'Synced':
    case 'OutOfSync':
      return value;
    default:
      return 'Unknown';
  }
}

// Telemetry cache (studio wiring, Phase 0 F1): `getTelemetry()` is the
// `isConnected` probe every wired studio calls per request, and each
// uncached call costs four list calls (nodes, pods, namespaces,
// ingresses). `K8sClient` is constructed fresh per request, so an
// instance cache would never hit — this is module-level, shared across
// instances, and keyed by kubeconfig context.
//
// TTL is 10s, the top of the plan's 5–10s range: telemetry is a
// point-in-time status snapshot, and counts 10s stale are invisible to
// operators (dashboard polling runs on the same cadence), while the
// cache collapses the 14-studio probe fan-out (up to 56 list calls per
// page load) to one fetch per 10s per context. It also bounds the cost
// of probing a dead API server — four failing list calls, each with its
// own client timeout — to once per 10s. A shorter TTL would halve the
// savings for no visible freshness gain; a longer one risks reporting
// a dead cluster as connected well past an operator's reaction time.
// The failure (offline) result is cached under the same bound, so a
// cluster that comes back is reported connected within 10s.
const TELEMETRY_CACHE_TTL_MS = 10_000;

interface TelemetryCacheEntry {
  telemetry: ClusterTelemetry;
  fetchedAtMs: number;
}

// One entry per kubeconfig context: the fleet views probe several
// contexts, and a single-entry cache would thrash between them. The
// key set is the kubeconfig's context list (small and fixed), so the
// map stays tiny.
const telemetryCache = new Map<string, TelemetryCacheEntry>();

/** Drop the cached telemetry (context switches; tests). */
export function clearTelemetryCache(): void {
  telemetryCache.clear();
}

// Cache entries are never handed out directly: callers get a copy, so
// in-place mutation of a returned telemetry object (e.g. sorting
// `nodes`) cannot corrupt the shared entry.
function copyTelemetry(t: ClusterTelemetry): ClusterTelemetry {
  return {
    ...t,
    nodes: [...t.nodes],
    namespaces: [...t.namespaces],
    ingresses: [...t.ingresses],
  };
}

export class K8sClient {
  private kc: k8s.KubeConfig;
  private coreApi?: k8s.CoreV1Api;
  private netApi?: k8s.NetworkingV1Api;
  private customApi?: k8s.CustomObjectsApi;
  private storageApi?: k8s.StorageV1Api;

  constructor() {
    this.kc = new k8s.KubeConfig();
    try {
      if (!process.env.KUBECONFIG && fs.existsSync('/etc/rancher/k3s/k3s.yaml')) {
        process.env.KUBECONFIG = '/etc/rancher/k3s/k3s.yaml';
      }
      this.kc.loadFromDefault();
      this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.netApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
      this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
      this.storageApi = this.kc.makeApiClient(k8s.StorageV1Api);
    } catch {
      // KubeConfig not present or cluster offline
    }
  }

  public async getTelemetry(): Promise<ClusterTelemetry> {
    const currentContext = this.kc.currentContext || '';

    if (!this.coreApi || !this.netApi) {
      return {
        isConnected: false,
        context: currentContext,
        detectedPlatform: 'unknown',
        detectedClusterName: '',
        nodeCount: 0,
        podCount: 0,
        namespaceCount: 0,
        ingressCount: 0,
        nodes: [],
        namespaces: [],
        ingresses: [],
        k8sVersion: '',
        cpuCapacityCores: 0,
        memoryCapacityGb: 0,
        server: this.kc.getCurrentCluster()?.server ?? '',
      };
    }

    // Serve a fresh-enough probe from the cache: the wired studios
    // call this per request, and the four list calls are the expensive
    // part. The no-API early return above is not cached — it performs
    // no I/O, so there is nothing to save.
    const cached = telemetryCache.get(currentContext);
    if (cached && Date.now() - cached.fetchedAtMs < TELEMETRY_CACHE_TTL_MS) {
      return copyTelemetry(cached.telemetry);
    }

    try {
      const [nodesRes, podsRes, nsRes, ingRes] = await Promise.all([
        this.coreApi.listNode().catch(() => ({ items: [] })),
        this.coreApi.listPodForAllNamespaces().catch(() => ({ items: [] })),
        this.coreApi.listNamespace().catch(() => ({ items: [] })),
        this.netApi.listIngressForAllNamespaces().catch(() => ({ items: [] })),
      ]);

      let detectedPlatform: 'kind' | 'k3d' | 'k3s' | 'unknown' = 'unknown';
      let detectedClusterName = '';

      if (currentContext.startsWith('k3d-')) {
        detectedPlatform = 'k3d';
        detectedClusterName = currentContext.replace(/^k3d-/, '');
      } else if (currentContext.startsWith('kind-')) {
        detectedPlatform = 'kind';
        detectedClusterName = currentContext.replace(/^kind-/, '');
      } else if (
        currentContext === 'default' ||
        currentContext.includes('k3s') ||
        fs.existsSync('/etc/rancher/k3s/k3s.yaml')
      ) {
        detectedPlatform = 'k3s';
        detectedClusterName = currentContext === 'default' ? 'axonwall-k3s' : currentContext;
      }

      const nodes = (nodesRes.items || []).map((n: k8s.V1Node) => {
        const readyCond = n.status?.conditions?.find((c: k8s.V1NodeCondition) => c.type === 'Ready');
        const roles = Object.keys(n.metadata?.labels || {})
          .filter((k) => k.startsWith('node-role.kubernetes.io/'))
          .map((k) => k.replace('node-role.kubernetes.io/', ''));
        const osImage = n.status?.nodeInfo?.osImage || '';
        const kubeletVersion = n.status?.nodeInfo?.kubeletVersion || '';
        const name = n.metadata?.name || 'unknown';

        if (name.startsWith('k3d-')) {
          detectedPlatform = 'k3d';
          const match = name.match(/^k3d-(.*?)-(server|agent)/);
          if (match && !detectedClusterName) {
            detectedClusterName = match[1];
          }
        } else if (name.startsWith('kind-') || osImage.includes('kindest')) {
          if (detectedPlatform === 'unknown') detectedPlatform = 'kind';
          if (!detectedClusterName && name.startsWith('kind-')) {
            const match = name.match(/^kind-(.*?)-(control-plane|worker)/);
            if (match) detectedClusterName = match[1];
          }
        } else if (osImage.toLowerCase().includes('k3s') || kubeletVersion.includes('+k3s')) {
          if (detectedPlatform === 'unknown') detectedPlatform = 'k3s';
          if (!detectedClusterName) detectedClusterName = 'axonwall-k3s';
        }

        return {
          name,
          status: readyCond?.status === 'True' ? 'Ready' : 'NotReady',
          roles: roles.length ? roles : ['worker'],
          age: n.metadata?.creationTimestamp?.toISOString() ?? '',
          osImage,
        };
      });

      const namespaces = (nsRes.items || []).map((ns: k8s.V1Namespace) => ns.metadata?.name || '');

      const ingresses = (ingRes.items || []).flatMap((ing: k8s.V1Ingress) => {
        const rules = ing.spec?.rules || [];
        return rules.map((r: k8s.V1IngressRule) => ({
          name: ing.metadata?.name || '',
          namespace: ing.metadata?.namespace || '',
          host: r.host || '*',
          class: ing.spec?.ingressClassName || '',
        }));
      });

      // Version + capacity come from the same node list, not from a
      // second call: kubelet version of the first node that reports one,
      // and the summed status.capacity across nodes. A cluster that
      // reports no capacity (e.g. a stubbed API) reads as 0, never NaN.
      const k8sVersion =
        (nodesRes.items || [])
          .map((n: k8s.V1Node) => n.status?.nodeInfo?.kubeletVersion || '')
          .find((v) => v !== '') ?? '';
      let cpuCapacityCores = 0;
      let memoryCapacityGb = 0;
      for (const n of nodesRes.items || []) {
        cpuCapacityCores += parseCpuCores(n.status?.capacity?.cpu);
        memoryCapacityGb += parseMemoryGiB(n.status?.capacity?.memory);
      }

      const telemetry: ClusterTelemetry = {
        isConnected: nodes.length > 0,
        context: currentContext,
        detectedPlatform,
        detectedClusterName,
        nodeCount: nodes.length,
        podCount: (podsRes.items || []).length,
        namespaceCount: namespaces.length,
        ingressCount: ingresses.length,
        nodes,
        namespaces,
        ingresses,
        k8sVersion,
        cpuCapacityCores: Math.round(cpuCapacityCores * 10) / 10,
        memoryCapacityGb: Math.round(memoryCapacityGb * 10) / 10,
        server: this.kc.getCurrentCluster()?.server ?? '',
      };
      telemetryCache.set(currentContext, { telemetry, fetchedAtMs: Date.now() });
      return copyTelemetry(telemetry);
    } catch {
      // The failure result is cached under the same bound: when the API
      // server is down, each of the four list calls fails (after its
      // own client timeout), so an uncached probe would pay that cost
      // on every studio request.
      const telemetry: ClusterTelemetry = {
        isConnected: false,
        context: currentContext,
        detectedPlatform: 'unknown',
        detectedClusterName: '',
        nodeCount: 0,
        podCount: 0,
        namespaceCount: 0,
        ingressCount: 0,
        nodes: [],
        namespaces: [],
        ingresses: [],
        k8sVersion: '',
        cpuCapacityCores: 0,
        memoryCapacityGb: 0,
        server: this.kc.getCurrentCluster()?.server ?? '',
      };
      telemetryCache.set(currentContext, { telemetry, fetchedAtMs: Date.now() });
      return copyTelemetry(telemetry);
    }
  }

  public getContexts(): { current: string; contexts: string[] } {
    return {
      current: this.kc.currentContext || '',
      contexts: this.kc.contexts.map((c) => c.name),
    };
  }

  /**
   * Rebuild the API clients for the kubeconfig's current context.
   * `makeApiClient` throws when there is no current cluster, so callers
   * must only call this when a current context exists.
   */
  private applyContext(): void {
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.netApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
    this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    this.storageApi = this.kc.makeApiClient(k8s.StorageV1Api);
  }

  /**
   * Run `fn` against the named kubeconfig context without touching the
   * kubeconfig file: the switch is in-memory only (`setCurrentContext`
   * + rebuilt API clients) and the previous context is restored in a
   * `finally`. Throws when the context does not exist in the kubeconfig.
   * When the kubeconfig had no current context there is nothing to
   * restore to (rebuilding clients with no current cluster throws), so
   * the client is left pointed at the probed context — fleet probes use
   * a request-scoped client that is discarded afterwards. The telemetry
   * cache is keyed by context, so probes under different contexts do
   * not collide.
   */
  public async withContext<T>(contextName: string, fn: (client: K8sClient) => Promise<T>): Promise<T> {
    if (!this.kc.contexts.some((c) => c.name === contextName)) {
      throw new Error(`Kubernetes context '${contextName}' not found in kubeconfig`);
    }
    const previous = this.kc.currentContext || '';
    this.kc.setCurrentContext(contextName);
    this.applyContext();
    try {
      return await fn(this);
    } finally {
      if (previous) {
        this.kc.setCurrentContext(previous);
        this.applyContext();
      }
    }
  }

  public async switchContext(contextName: string): Promise<void> {
    await execFileAsync('kubectl', ['config', 'use-context', contextName]);
    // Reload kubeconfig
    this.kc.loadFromDefault();
    this.applyContext();
    // The cache is keyed by context, but drop it explicitly: a switch
    // that leaves currentContext empty (no current-context in the
    // kubeconfig) would otherwise keep serving the old context's entry.
    clearTelemetryCache();
  }

  public async getCertificates(): Promise<CertificateInfo[]> {
    if (!this.customApi) return [];
    try {
      const res: { items?: CertManagerCertificate[] } | null = await this.customApi.listClusterCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        plural: 'certificates',
      }).catch(() => null);

      if (!res || !res.items) return [];

      return res.items.map((item) => {
        const readyCond = item.status?.conditions?.find((c) => c.type === 'Ready');
        return {
          name: item.metadata?.name || '',
          namespace: item.metadata?.namespace || '',
          ready: readyCond?.status === 'True',
          status: readyCond?.message || readyCond?.reason || 'Unknown',
          secretName: item.spec?.secretName || '',
          dnsNames: item.spec?.dnsNames || [],
          issuer: item.spec?.issuerRef?.name || '',
          renewBefore: item.status?.renewalTime,
          notAfter: item.status?.notAfter,
        };
      });
    } catch {
      return [];
    }
  }

  public async getClusterIssuers(): Promise<ClusterIssuerInfo[]> {
    if (!this.customApi) return [];
    try {
      const res: { items?: CertManagerClusterIssuer[] } | null = await this.customApi.listClusterCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        plural: 'clusterissuers',
      }).catch(() => null);

      if (!res || !res.items) return [];

      return res.items.map((item) => {
        const readyCond = item.status?.conditions?.find((c) => c.type === 'Ready');
        return {
          name: item.metadata?.name || '',
          ready: readyCond?.status === 'True',
          type: item.spec?.ca ? 'CA' : item.spec?.acme ? 'ACME / Let\'s Encrypt' : 'SelfSigned',
          status: readyCond?.message || readyCond?.reason || 'Unknown',
        };
      });
    } catch {
      return [];
    }
  }

  public async getArgoApplications(): Promise<{ installed: boolean; applications: ArgoAppStatus[] }> {
    if (!this.customApi) return { installed: false, applications: [] };
    try {
      // ArgoCD applications are namespaced, typically in 'argocd'
      const res: { items?: ArgoApplicationObject[] } | null = await this.customApi.listNamespacedCustomObject({
        group: 'argoproj.io',
        version: 'v1alpha1',
        namespace: 'argocd',
        plural: 'applications',
      }).catch(() => null);

      if (!res || !res.items) {
        return { installed: false, applications: [] };
      }

      const applications: ArgoAppStatus[] = res.items.map((app) => ({
        name: app.metadata?.name || '',
        namespace: app.metadata?.namespace || 'argocd',
        healthStatus: asArgoHealthStatus(app.status?.health?.status),
        healthMessage: app.status?.health?.message,
        syncStatus: asArgoSyncStatus(app.status?.sync?.status),
        revision: app.status?.sync?.revision,
        repoURL: app.spec?.source?.repoURL,
        targetPath: app.spec?.source?.path,
        destinationServer: app.spec?.destination?.server,
        destinationNamespace: app.spec?.destination?.namespace,
      }));

      return {
        installed: true,
        applications,
      };
    } catch {
      return { installed: false, applications: [] };
    }
  }

  public async getPods(namespace?: string): Promise<PodInfo[]> {
    if (!this.coreApi) return [];
    try {
      const res = namespace
        ? await this.coreApi.listNamespacedPod({ namespace }).catch(() => ({ items: [] }))
        : await this.coreApi.listPodForAllNamespaces().catch(() => ({ items: [] }));

      return (res.items || []).map((pod: k8s.V1Pod) => {
        const containerStatuses = pod.status?.containerStatuses || [];
        const readyContainers = containerStatuses.filter((c) => c.ready).length;
        const totalContainers = pod.spec?.containers?.length || 1;
        const restartCount = containerStatuses.reduce((acc: number, c) => acc + (c.restartCount || 0), 0);

        let status = pod.status?.phase || 'Unknown';
        // Check for waiting reasons like CrashLoopBackOff or ImagePullBackOff
        for (const cs of containerStatuses) {
          if (cs.state?.waiting?.reason) {
            status = cs.state.waiting.reason;
            break;
          }
        }

        return {
          name: pod.metadata?.name || '',
          namespace: pod.metadata?.namespace || '',
          status,
          ready: `${readyContainers}/${totalContainers}`,
          restarts: restartCount,
          node: pod.spec?.nodeName || 'unknown',
          ip: pod.status?.podIP || '',
          age: pod.metadata?.creationTimestamp?.toISOString() ?? '',
          containers: (pod.spec?.containers || []).map((c) => {
            const cs = containerStatuses.find((s) => s.name === c.name);
            return {
              name: c.name,
              image: c.image ?? '',
              ready: cs?.ready || false,
              restartCount: cs?.restartCount || 0,
            };
          }),
        };
      });
    } catch {
      return [];
    }
  }

  public async getPodLogs(params: {
    namespace: string;
    name: string;
    container?: string;
    tailLines?: number;
  }): Promise<string> {
    if (!this.coreApi) return 'Kubernetes API not connected';
    try {
      // The v2 client resolves this call to the log text directly
      // (Promise<string>); there is no response-object body to unwrap.
      const res = await this.coreApi.readNamespacedPodLog({
        name: params.name,
        namespace: params.namespace,
        container: params.container,
        tailLines: params.tailLines ?? 200,
        timestamps: true,
      });

      if (typeof res === 'string') return res;
      return String(res || '');
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Unknown error';
      return `Failed to fetch logs: ${message}`;
    }
  }

  public async getStorage(): Promise<StorageInfo> {
    const result: StorageInfo = {
      storageClasses: [],
      persistentVolumes: [],
      persistentVolumeClaims: [],
    };

    if (!this.coreApi) return result;

    try {
      const [scRes, pvRes, pvcRes] = await Promise.all([
        this.storageApi ? this.storageApi.listStorageClass().catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        this.coreApi.listPersistentVolume().catch(() => ({ items: [] })),
        this.coreApi.listPersistentVolumeClaimForAllNamespaces().catch(() => ({ items: [] })),
      ]);

      result.storageClasses = (scRes.items || []).map((sc: k8s.V1StorageClass) => ({
        name: sc.metadata?.name || '',
        provisioner: sc.provisioner || '',
        reclaimPolicy: sc.reclaimPolicy || 'Delete',
        volumeBindingMode: sc.volumeBindingMode || 'Immediate',
        isDefault: sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
      }));

      result.persistentVolumes = (pvRes.items || []).map((pv: k8s.V1PersistentVolume) => ({
        name: pv.metadata?.name || '',
        capacity: pv.spec?.capacity?.storage || '',
        accessModes: pv.spec?.accessModes || [],
        reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || 'Retain',
        status: pv.status?.phase || 'Unknown',
        claim: pv.spec?.claimRef ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}` : '',
        storageClass: pv.spec?.storageClassName || '',
      }));

      result.persistentVolumeClaims = (pvcRes.items || []).map((pvc: k8s.V1PersistentVolumeClaim) => ({
        name: pvc.metadata?.name || '',
        namespace: pvc.metadata?.namespace || '',
        status: pvc.status?.phase || 'Unknown',
        volume: pvc.spec?.volumeName || '',
        capacity: pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || '',
        accessModes: pvc.spec?.accessModes || [],
        storageClass: pvc.spec?.storageClassName || '',
      }));

      return result;
    } catch {
      return result;
    }
  }

  /**
   * List all Secrets (metadata + data key names only — never values).
   *
   * Unlike the older read methods in this class, which swallow API
   * failures into empty lists, this throws on API failure: the SecretOps
   * audit must fail loudly rather than report "0 secrets, 0 leaks" for
   * a dead API server. The no-cluster case is gated earlier by the
   * getTelemetry() probe.
   */
  public async getSecrets(): Promise<SecretInfo[]> {
    if (!this.coreApi) throw new Error('Kubernetes API not connected');
    const res = await this.coreApi.listSecretForAllNamespaces();
    return (res.items || []).map((s: k8s.V1Secret) => secretInfoOf(s));
  }

  /**
   * Read one Secret with its full data map (base64 values), for the
   * rotation flow's manifest rebuild. Returns null on a 404; any other
   * API failure throws. Values are held in memory only — never logged,
   * persisted, or returned to callers.
   */
  public async getSecret(name: string, namespace: string): Promise<SecretDetail | null> {
    if (!this.coreApi) throw new Error('Kubernetes API not connected');
    try {
      const s = await this.coreApi.readNamespacedSecret({ name, namespace });
      return { ...secretInfoOf(s), data: { ...(s.data || {}) } };
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /** List all ConfigMaps with their string data (scanned in memory by the audit). */
  public async getConfigMaps(): Promise<ConfigMapInfo[]> {
    if (!this.coreApi) throw new Error('Kubernetes API not connected');
    const res = await this.coreApi.listConfigMapForAllNamespaces();
    return (res.items || []).map((cm: k8s.V1ConfigMap) => ({
      name: cm.metadata?.name || '',
      namespace: cm.metadata?.namespace || '',
      data: { ...(cm.data || {}) },
    }));
  }

  /**
   * List pod specs — env/args/volumes/owners — for the leak scan and
   * rotation's dependent-workload discovery. Values are needed for
   * pattern matching and are held in memory only by the caller.
   */
  public async getPodSpecs(): Promise<PodSpecInfo[]> {
    if (!this.coreApi) throw new Error('Kubernetes API not connected');
    const res = await this.coreApi.listPodForAllNamespaces();
    return (res.items || []).map((pod: k8s.V1Pod) => {
      const owner = pod.metadata?.ownerReferences?.[0];
      return {
        name: pod.metadata?.name || '',
        namespace: pod.metadata?.namespace || '',
        ownerKind: owner?.kind,
        ownerName: owner?.name,
        containers: (pod.spec?.containers || []).map((c) => ({
          name: c.name,
          env: (c.env || []).map((e) => {
            const entry: PodEnvVar = { name: e.name };
            if (e.value !== undefined) entry.value = e.value;
            const secretRef = e.valueFrom?.secretKeyRef;
            const cmRef = e.valueFrom?.configMapKeyRef;
            if (secretRef) {
              entry.valueFromKind = 'secretKeyRef';
              entry.valueFromName = secretRef.name;
              entry.valueFromKey = secretRef.key;
            } else if (cmRef) {
              entry.valueFromKind = 'configMapKeyRef';
              entry.valueFromName = cmRef.name;
              entry.valueFromKey = cmRef.key;
            }
            return entry;
          }),
          envFromSecrets: (c.envFrom || [])
            .map((f) => f.secretRef?.name)
            .filter((n): n is string => !!n),
          envFromConfigMaps: (c.envFrom || [])
            .map((f) => f.configMapRef?.name)
            .filter((n): n is string => !!n),
          args: [...(c.args || [])],
        })),
        volumes: (pod.spec?.volumes || []).map((v) => {
          const entry: PodVolumeSpec = { name: v.name };
          if (v.secret?.secretName) entry.secretName = v.secret.secretName;
          if (v.configMap?.name) entry.configMapName = v.configMap.name;
          return entry;
        }),
      };
    });
  }

  /**
   * External Secrets Operator status for the audit's vault-connected
   * flag. `installed` is false when the ESO CRDs are absent (404);
   * any other API failure throws. Connected means a SecretStore is
   * Ready or at least one ExternalSecret reports Ready — either proves
   * the backend (Vault) was reached.
   */
  public async getExternalSecretsStatus(): Promise<ExternalSecretsStatus> {
    const empty: ExternalSecretsStatus = {
      installed: false,
      externalSecretCount: 0,
      readyExternalSecretCount: 0,
      storeReady: false,
    };
    if (!this.customApi) return empty;
    try {
      const [esRes, storeRes] = await Promise.all([
        this.customApi.listClusterCustomObject({
          group: 'external-secrets.io',
          version: 'v1beta1',
          plural: 'externalsecrets',
        }),
        this.customApi.listClusterCustomObject({
          group: 'external-secrets.io',
          version: 'v1beta1',
          plural: 'clustersecretstores',
        }),
      ]);
      const externals = ((esRes as { items?: ExternalSecretObject[] }).items || []) as ExternalSecretObject[];
      const stores = ((storeRes as { items?: ExternalSecretStoreObject[] }).items || []) as ExternalSecretStoreObject[];
      const readyCount = externals.filter((es) =>
        es.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
      ).length;
      const storeReady = stores.some((s) =>
        s.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
      );
      return {
        installed: true,
        externalSecretCount: externals.length,
        readyExternalSecretCount: readyCount,
        storeReady,
      };
    } catch (err) {
      if (isNotFoundError(err)) return empty;
      throw err;
    }
  }
}

export interface CertificateInfo {
  name: string;
  namespace: string;
  ready: boolean;
  status: string;
  secretName: string;
  dnsNames: string[];
  issuer: string;
  renewBefore?: string;
  notAfter?: string;
}

export interface ClusterIssuerInfo {
  name: string;
  ready: boolean;
  type: string;
  status: string;
}
