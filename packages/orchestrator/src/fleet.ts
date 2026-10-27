export interface FleetCluster {
  id: string;
  name: string;
  environment: 'local' | 'dev' | 'staging' | 'production';
  provider: 'kind' | 'k3d' | 'eks' | 'gke' | 'aks';
  k8sVersion: string;
  nodeCount: number;
  podCount: number;
  cpuCapacityCores: number;
  memoryCapacityGb: number;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  isCurrentContext: boolean;
  location: string;
  argocdSyncStatus: 'Synced' | 'OutOfSync' | 'Progressing';
}

const fleetStore: FleetCluster[] = [
  {
    id: 'cluster-kind-local',
    name: 'kind-control-plane',
    environment: 'local',
    provider: 'kind',
    k8sVersion: 'v1.31.2',
    nodeCount: 1,
    podCount: 24,
    cpuCapacityCores: 8,
    memoryCapacityGb: 16,
    status: 'ONLINE',
    isCurrentContext: true,
    location: '127.0.0.1 (Local Workstation)',
    argocdSyncStatus: 'Synced',
  },
  {
    id: 'cluster-k3d-edge',
    name: 'k3d-edge-node-01',
    environment: 'dev',
    provider: 'k3d',
    k8sVersion: 'v1.30.4+k3s1',
    nodeCount: 3,
    podCount: 18,
    cpuCapacityCores: 12,
    memoryCapacityGb: 24,
    status: 'ONLINE',
    isCurrentContext: false,
    location: '10.46.48.100 (LAN Edge Rack)',
    argocdSyncStatus: 'Synced',
  },
  {
    id: 'cluster-aws-eks',
    name: 'prod-us-east-1-eks',
    environment: 'production',
    provider: 'eks',
    k8sVersion: 'v1.31.0',
    nodeCount: 6,
    podCount: 84,
    cpuCapacityCores: 48,
    memoryCapacityGb: 192,
    status: 'ONLINE',
    isCurrentContext: false,
    location: 'AWS us-east-1 (N. Virginia)',
    argocdSyncStatus: 'Synced',
  },
  {
    id: 'cluster-gcp-gke',
    name: 'staging-europe-west1-gke',
    environment: 'staging',
    provider: 'gke',
    k8sVersion: 'v1.30.5-gke.101',
    nodeCount: 4,
    podCount: 52,
    cpuCapacityCores: 32,
    memoryCapacityGb: 128,
    status: 'ONLINE',
    isCurrentContext: false,
    location: 'GCP europe-west1 (Belgium)',
    argocdSyncStatus: 'OutOfSync',
  },
];

export async function listFleetClusters(): Promise<FleetCluster[]> {
  return [...fleetStore];
}

export async function switchClusterContext(clusterId: string): Promise<{ success: boolean; activeCluster: FleetCluster | null; message: string }> {
  const target = fleetStore.find((c) => c.id === clusterId);
  if (!target) {
    return { success: false, activeCluster: null, message: `Cluster ${clusterId} not found.` };
  }

  fleetStore.forEach((c) => {
    c.isCurrentContext = c.id === clusterId;
  });

  return {
    success: true,
    activeCluster: target,
    message: `Switched active kubectl context to [${target.name}] (${target.provider.toUpperCase()}).`,
  };
}

export async function broadcastApplication(
  appId: string,
  targetClusterIds: string[]
): Promise<{ success: boolean; deployedClusters: string[]; message: string }> {
  const deployed = fleetStore.filter((c) => targetClusterIds.includes(c.id));
  deployed.forEach((c) => {
    c.argocdSyncStatus = 'Synced';
  });

  return {
    success: true,
    deployedClusters: deployed.map((c) => c.name),
    message: `Broadcasted application [${appId}] manifests and GitOps synchronization to ${deployed.length} fleet clusters.`,
  };
}
