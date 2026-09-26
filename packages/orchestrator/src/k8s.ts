import * as k8s from '@kubernetes/client-node';

export interface ClusterTelemetry {
  isConnected: boolean;
  nodeCount: number;
  podCount: number;
  namespaceCount: number;
  ingressCount: number;
  nodes: { name: string; status: string; roles: string[]; age: string }[];
  namespaces: string[];
  ingresses: { name: string; namespace: string; host: string; class: string }[];
}

export class K8sClient {
  private kc: k8s.KubeConfig;
  private coreApi?: k8s.CoreV1Api;
  private netApi?: k8s.NetworkingV1Api;
  private customApi?: k8s.CustomObjectsApi;

  constructor() {
    this.kc = new k8s.KubeConfig();
    try {
      this.kc.loadFromDefault();
      this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.netApi = this.kc.makeApiClient(k8s.NetworkingV1Api);
      this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    } catch {
      // KubeConfig not present or cluster offline
    }
  }

  public async getTelemetry(): Promise<ClusterTelemetry> {
    if (!this.coreApi || !this.netApi) {
      return {
        isConnected: false,
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

      const nodes = (nodesRes.items || []).map((n: any) => {
        const readyCond = n.status?.conditions?.find((c: any) => c.type === 'Ready');
        const roles = Object.keys(n.metadata?.labels || {})
          .filter((k) => k.startsWith('node-role.kubernetes.io/'))
          .map((k) => k.replace('node-role.kubernetes.io/', ''));

        return {
          name: n.metadata?.name || 'unknown',
          status: readyCond?.status === 'True' ? 'Ready' : 'NotReady',
          roles: roles.length ? roles : ['worker'],
          age: n.metadata?.creationTimestamp || '',
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
}
