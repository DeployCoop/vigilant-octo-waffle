import * as k8s from '@kubernetes/client-node';
import { execFileAsync, assertK8sObjectName } from './exec-argv.js';

// One row of `k3d node list --output json`.
interface K3dNodeListEntry {
  name: string;
  cluster?: string;
  role?: string;
}

export interface NodeDetail {
  name: string;
  role: 'control-plane' | 'worker';
  status: string;
  cpuCapacity: string;
  memoryCapacity: string;
  labels: Record<string, string>;
  taints: { key: string; value?: string; effect: string }[];
}

export async function listClusterNodeDetails(): Promise<NodeDetail[]> {
  try {
    const { stdout } = await execFileAsync('kubectl', ['get', 'nodes', '-o', 'json']);
    const parsed = JSON.parse(stdout) as k8s.V1NodeList;
    const items = parsed.items || [];

    return items.map((node) => {
      const labels = node.metadata?.labels || {};
      const isControlPlane = Object.keys(labels).some((k) => k.includes('control-plane') || k.includes('master'));
      const readyCond = node.status?.conditions?.find((c) => c.type === 'Ready');

      const rawTaints = node.spec?.taints || [];
      const taints = rawTaints.map((t) => ({
        key: t.key,
        value: t.value,
        effect: t.effect,
      }));

      return {
        name: node.metadata?.name || '',
        role: isControlPlane ? 'control-plane' : 'worker',
        status: readyCond?.status === 'True' ? 'Ready' : 'NotReady',
        cpuCapacity: node.status?.capacity?.cpu || '',
        memoryCapacity: node.status?.capacity?.memory || '',
        labels,
        taints,
      };
    });
  } catch {
    return [];
  }
}

export async function scaleK3dNodes(clusterName: string, targetAgentCount: number): Promise<{ success: boolean; message: string }> {
  try {
    assertK8sObjectName(clusterName, 'cluster name');
    // 1. Get current nodes
    const { stdout } = await execFileAsync('k3d', ['node', 'list', '--output', 'json']).catch(() => ({ stdout: '' }));
    const parsed: K3dNodeListEntry[] = stdout ? JSON.parse(stdout) : [];
    const currentAgents = parsed.filter((n) => n.cluster === clusterName && n.role === 'agent');

    const diff = targetAgentCount - currentAgents.length;
    if (diff === 0) {
      return { success: true, message: `Cluster ${clusterName} already has ${targetAgentCount} worker nodes.` };
    }

    if (diff > 0) {
      // Add worker nodes
      for (let i = 0; i < diff; i++) {
        const nodeName = `${clusterName}-agent-${currentAgents.length + i}`;
        await execFileAsync('k3d', ['node', 'create', nodeName, '--cluster', clusterName, '--role', 'agent']);
      }
      return { success: true, message: `Added ${diff} worker node(s) to cluster ${clusterName}.` };
    } else {
      // Remove excess worker nodes
      const toRemove = currentAgents.slice(0, Math.abs(diff));
      for (const node of toRemove) {
        await execFileAsync('k3d', ['node', 'delete', node.name]);
      }
      return { success: true, message: `Removed ${Math.abs(diff)} worker node(s) from cluster ${clusterName}.` };
    }
  } catch (err) {
    return { success: false, message: `Failed scaling nodes: ${err instanceof Error ? err.message : String(err)}` };
  }
}
