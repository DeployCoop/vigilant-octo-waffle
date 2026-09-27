import * as k8s from '@kubernetes/client-node';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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

export class K8sClient {
  private kc: k8s.KubeConfig;
  private coreApi?: k8s.CoreV1Api;
  private netApi?: k8s.NetworkingV1Api;
  private customApi?: k8s.CustomObjectsApi;
  private storageApi?: k8s.StorageV1Api;

  constructor() {
    this.kc = new k8s.KubeConfig();
    try {
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
      };
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
      }

      const nodes = (nodesRes.items || []).map((n: any) => {
        const readyCond = n.status?.conditions?.find((c: any) => c.type === 'Ready');
        const roles = Object.keys(n.metadata?.labels || {})
          .filter((k) => k.startsWith('node-role.kubernetes.io/'))
          .map((k) => k.replace('node-role.kubernetes.io/', ''));
        const osImage = n.status?.nodeInfo?.osImage || '';
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
        } else if (osImage.toLowerCase().includes('k3s')) {
          if (detectedPlatform === 'unknown') detectedPlatform = 'k3s';
        }

        return {
          name,
          status: readyCond?.status === 'True' ? 'Ready' : 'NotReady',
          roles: roles.length ? roles : ['worker'],
          age: n.metadata?.creationTimestamp || '',
          osImage,
        };
      });

      const namespaces = (nsRes.items || []).map((ns: any) => ns.metadata?.name || '');

      const ingresses = (ingRes.items || []).flatMap((ing: any) => {
        const rules = ing.spec?.rules || [];
        return rules.map((r: any) => ({
          name: ing.metadata?.name || '',
          namespace: ing.metadata?.namespace || '',
          host: r.host || '*',
          class: ing.spec?.ingressClassName || '',
        }));
      });

      return {
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
      };
    } catch {
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
      };
    }
  }

  public getContexts(): { current: string; contexts: string[] } {
    return {
      current: this.kc.currentContext || '',
      contexts: this.kc.contexts.map((c) => c.name),
    };
  }

  public async switchContext(contextName: string): Promise<void> {
    await execAsync(`kubectl config use-context ${JSON.stringify(contextName)}`);
    // Reload kubeconfig
    this.kc.loadFromDefault();
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.netApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
    this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    this.storageApi = this.kc.makeApiClient(k8s.StorageV1Api);
  }

  public async getCertificates(): Promise<CertificateInfo[]> {
    if (!this.customApi) return [];
    try {
      const res: any = await this.customApi.listClusterCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        plural: 'certificates',
      }).catch(() => null);

      if (!res || !res.items) return [];

      return res.items.map((item: any) => {
        const readyCond = item.status?.conditions?.find((c: any) => c.type === 'Ready');
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
      const res: any = await this.customApi.listClusterCustomObject({
        group: 'cert-manager.io',
        version: 'v1',
        plural: 'clusterissuers',
      }).catch(() => null);

      if (!res || !res.items) return [];

      return res.items.map((item: any) => {
        const readyCond = item.status?.conditions?.find((c: any) => c.type === 'Ready');
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
      const res: any = await this.customApi.listNamespacedCustomObject({
        group: 'argoproj.io',
        version: 'v1alpha1',
        namespace: 'argocd',
        plural: 'applications',
      }).catch(() => null);

      if (!res || !res.items) {
        return { installed: false, applications: [] };
      }

      const applications: ArgoAppStatus[] = res.items.map((app: any) => ({
        name: app.metadata?.name || '',
        namespace: app.metadata?.namespace || 'argocd',
        healthStatus: (app.status?.health?.status as any) || 'Unknown',
        healthMessage: app.status?.health?.message,
        syncStatus: (app.status?.sync?.status as any) || 'Unknown',
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

      return (res.items || []).map((pod: any) => {
        const containerStatuses = pod.status?.containerStatuses || [];
        const readyContainers = containerStatuses.filter((c: any) => c.ready).length;
        const totalContainers = pod.spec?.containers?.length || 1;
        const restartCount = containerStatuses.reduce((acc: number, c: any) => acc + (c.restartCount || 0), 0);

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
          age: pod.metadata?.creationTimestamp || '',
          containers: (pod.spec?.containers || []).map((c: any) => {
            const cs = containerStatuses.find((s: any) => s.name === c.name);
            return {
              name: c.name,
              image: c.image,
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
      const res: any = await this.coreApi.readNamespacedPodLog({
        name: params.name,
        namespace: params.namespace,
        container: params.container,
        tailLines: params.tailLines ?? 200,
        timestamps: true,
      });

      if (typeof res === 'string') return res;
      if (typeof res?.body === 'string') return res.body;
      return String(res || '');
    } catch (err: any) {
      return `Failed to fetch logs: ${err.message || 'Unknown error'}`;
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

      result.storageClasses = (scRes.items || []).map((sc: any) => ({
        name: sc.metadata?.name || '',
        provisioner: sc.provisioner || '',
        reclaimPolicy: sc.reclaimPolicy || 'Delete',
        volumeBindingMode: sc.volumeBindingMode || 'Immediate',
        isDefault: sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
      }));

      result.persistentVolumes = (pvRes.items || []).map((pv: any) => ({
        name: pv.metadata?.name || '',
        capacity: pv.spec?.capacity?.storage || '',
        accessModes: pv.spec?.accessModes || [],
        reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || 'Retain',
        status: pv.status?.phase || 'Unknown',
        claim: pv.spec?.claimRef ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}` : '',
        storageClass: pv.spec?.storageClassName || '',
      }));

      result.persistentVolumeClaims = (pvcRes.items || []).map((pvc: any) => ({
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
