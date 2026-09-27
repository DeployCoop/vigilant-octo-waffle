import { APP_CATALOG, type AppDefinition } from './registry.js';

export interface TopologyNode {
  id: string;
  name: string;
  category: string;
  layer: 1 | 2 | 3 | 4;
  layerName: string;
  enabled: boolean;
  subdomain?: string;
  ingressUrl?: string;
  estimatedMemoryMb?: number;
  dependencies: string[];
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  type: 'dependency' | 'ingress' | 'cluster';
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  layers: { layer: 1 | 2 | 3 | 4; name: string; nodeCount: number }[];
}

export function buildTopologyGraph(
  enabledAppIds: string[],
  domain = '127.0.0.1.sslip.io'
): TopologyGraph {
  const enabledSet = new Set(enabledAppIds);
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // Categorize apps into layers:
  // Layer 1: Cluster Core, Networking & Ingress
  // Layer 2: Foundation & Storage (DBs, MinIO, OpenEBS)
  // Layer 3: Gateways, Security & GitOps (ArgoCD, Keycloak, Harbor)
  // Layer 4: Workloads, Applications & Monitoring (Grafana, CVAT, Nextcloud, etc.)

  for (const app of APP_CATALOG) {
    let layer: 1 | 2 | 3 | 4 = 4;
    let layerName = 'Workloads & Services';

    if (
      app.id === 'certmanager' ||
      app.category === 'Networking & Ingress' ||
      app.id === 'traefik' ||
      app.id === 'spegel'
    ) {
      layer = 1;
      layerName = 'Core & Ingress Network';
    } else if (
      app.id === 'kubegres' ||
      app.id === 'minio-tenant' ||
      app.id === 'openebs' ||
      app.id === 'dragonfly' ||
      app.category === 'Databases & Storage'
    ) {
      layer = 2;
      layerName = 'Storage & Persistence';
    } else if (
      app.id === 'argocd' ||
      app.id === 'keycloak' ||
      app.id === 'goharbor' ||
      app.id === 'authentik' ||
      app.category === 'Security & Identity'
    ) {
      layer = 3;
      layerName = 'Gateways & Control Plane';
    }

    const isEnabled = enabledSet.has(app.id);
    const ingressUrl = app.subdomain ? `https://${app.subdomain}.${domain}` : undefined;

    nodes.push({
      id: app.id,
      name: app.name,
      category: app.category,
      layer,
      layerName,
      enabled: isEnabled,
      subdomain: app.subdomain,
      ingressUrl,
      estimatedMemoryMb: app.estimatedMemoryMb,
      dependencies: app.dependencies || [],
    });

    // Create dependency edges
    if (app.dependencies) {
      for (const dep of app.dependencies) {
        edges.push({
          id: `${dep}->${app.id}`,
          source: dep,
          target: app.id,
          type: 'dependency',
        });
      }
    }

    // Connect certmanager to apps that have ingress
    if (app.subdomain && app.id !== 'certmanager') {
      edges.push({
        id: `certmanager->${app.id}`,
        source: 'certmanager',
        target: app.id,
        type: 'ingress',
      });
    }
  }

  const layerCounts: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const n of nodes) {
    layerCounts[n.layer]++;
  }

  const layers = [
    { layer: 1 as const, name: 'Core & Ingress Network', nodeCount: layerCounts[1] },
    { layer: 2 as const, name: 'Storage & Persistence', nodeCount: layerCounts[2] },
    { layer: 3 as const, name: 'Gateways & Control Plane', nodeCount: layerCounts[3] },
    { layer: 4 as const, name: 'Workloads & Services', nodeCount: layerCounts[4] },
  ];

  return {
    nodes,
    edges,
    layers,
  };
}
