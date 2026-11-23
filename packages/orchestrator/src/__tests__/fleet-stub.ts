/**
 * Shared one-context fleet stub for tests that only need "a fleet exists"
 * (e.g. the C4 contract test). The full multi-context stub lives in
 * fleet.test.ts; this helper is deliberately minimal.
 */
import type { FleetDeps, FleetK8sClient } from '../fleet.js';
import type { ClusterTelemetry } from '../k8s.js';

function telemetry(): ClusterTelemetry {
  return {
    isConnected: true,
    context: 'kind-local',
    detectedPlatform: 'kind',
    detectedClusterName: 'local',
    nodeCount: 1,
    podCount: 24,
    namespaceCount: 3,
    ingressCount: 0,
    nodes: [
      { name: 'node-1', status: 'Ready', roles: ['control-plane'], age: '', osImage: 'Ubuntu 24.04' },
    ],
    namespaces: ['default'],
    ingresses: [],
    k8sVersion: 'v1.31.2',
    cpuCapacityCores: 8,
    memoryCapacityGb: 16,
    server: 'https://127.0.0.1:6443',
  };
}

class OneContextClient implements FleetK8sClient {
  private current = 'kind-local';

  getContexts(): { current: string; contexts: string[] } {
    return { current: this.current, contexts: ['kind-local'] };
  }

  async withContext<T>(
    contextName: string,
    fn: (client: FleetK8sClient) => Promise<T>
  ): Promise<T> {
    if (contextName !== 'kind-local') {
      throw new Error(`Kubernetes context '${contextName}' not found in kubeconfig`);
    }
    return fn(this);
  }

  async getTelemetry(): Promise<ClusterTelemetry> {
    return telemetry();
  }

  async getArgoApplications(): Promise<{
    installed: boolean;
    applications: { name: string; namespace: string; healthStatus: 'Healthy'; syncStatus: 'Synced' }[];
  }> {
    return {
      installed: true,
      applications: [{ name: 'nextcloud', namespace: 'argocd', healthStatus: 'Healthy', syncStatus: 'Synced' }],
    };
  }

  async switchContext(contextName: string): Promise<void> {
    if (contextName !== 'kind-local') {
      throw new Error(`kubectl: context '${contextName}' not found`);
    }
    this.current = contextName;
  }
}

/** Deps for a one-context online kind fleet with a succeeding sync stub. */
export function stubFleetDeps(): FleetDeps {
  return {
    client: new OneContextClient(),
    cdRunner: 'argocd',
    projectRoot: '/tmp/vow-fleet-test',
    syncApp: async () => ({
      code: 0,
      status: 'completed',
      logs: [],
      stdout: '',
      stderr: '',
      taskId: 'task_test',
    }),
  };
}
