/**
 * Cluster context builder for AI prompts (WS6 split of antigravity.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import { K8sClient, type ClusterTelemetry, type PodInfo, type ArgoAppStatus } from '../k8s.js';
import { loadProjectConfig } from '../config.js';
import { APP_CATALOG } from '../registry.js';
import { type AntigravityResponse } from './types.js';

/**
 * Gathers a rich snapshot of live cluster telemetry and returns
 * both formatted markdown for the LLM prompt and a structured summary.
 */
export async function buildClusterContext(root: string): Promise<{
  promptContext: string;
  snapshot: AntigravityResponse['clusterSnapshot'];
}> {
  const k8s = new K8sClient();
  let telemetry: ClusterTelemetry = {
    isConnected: false,
    context: '',
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

  let pods: PodInfo[] = [];
  let argoApps: { installed: boolean; applications: ArgoAppStatus[] } = {
    installed: false,
    applications: [],
  };

  try {
    telemetry = await k8s.getTelemetry();
  } catch {}

  if (telemetry.isConnected) {
    try {
      pods = await k8s.getPods();
    } catch {}
    try {
      argoApps = await k8s.getArgoApplications();
    } catch {}
  }

  let projectConfig: any = null;
  try {
    projectConfig = loadProjectConfig(root);
  } catch {}

  const unhealthyPods = pods.filter((p) => {
    const s = p.status.toLowerCase();
    return (
      s.includes('crash') ||
      s.includes('error') ||
      s.includes('backoff') ||
      s.includes('pending') ||
      s.includes('failed') ||
      p.restarts > 3
    );
  });

  const configuredPlatform =
    telemetry.detectedPlatform !== 'unknown'
      ? telemetry.detectedPlatform
      : projectConfig?.cluster?.k8sPlatform || 'kind';

  const snapshot: AntigravityResponse['clusterSnapshot'] = {
    connected: telemetry.isConnected,
    context: telemetry.context || 'none',
    platform: configuredPlatform,
    nodeCount: telemetry.nodeCount,
    podCount: telemetry.podCount,
    unhealthyPods: unhealthyPods.map((p) => `${p.namespace}/${p.name} (${p.status})`),
    applicationsCount: APP_CATALOG.length,
  };

  const lines: string[] = [];
  lines.push('### Live Kubernetes Cluster Telemetry');
  lines.push(`- **Status**: ${telemetry.isConnected ? 'Connected & Healthy' : 'Disconnected / Offline'}`);
  lines.push(`- **Context**: ${telemetry.context || 'Not connected'}`);
  lines.push(`- **Platform**: ${configuredPlatform.toUpperCase()} (${telemetry.detectedClusterName || 'default'})`);
  lines.push(`- **Active Nodes**: ${telemetry.nodeCount} nodes`);

  if (telemetry.nodes && telemetry.nodes.length > 0) {
    lines.push('  Nodes list:');
    telemetry.nodes.forEach((n) => {
      lines.push(`  - \`${n.name}\`: Status=${n.status}, Roles=${n.roles.join(',')}, OS=${n.osImage || 'Linux'}`);
    });
  }

  lines.push(`- **Namespaces (${telemetry.namespaceCount})**: ${telemetry.namespaces.join(', ') || 'none'}`);
  lines.push(`- **Total Pods**: ${telemetry.podCount}`);

  if (unhealthyPods.length > 0) {
    lines.push('⚠️ **Degraded or Unhealthy Pods Detected**:');
    unhealthyPods.forEach((p) => {
      lines.push(`  - \`${p.namespace}/${p.name}\`: Status=\`${p.status}\`, Ready=\`${p.ready}\`, Restarts=${p.restarts}, Node=\`${p.node}\``);
    });
  } else if (telemetry.isConnected) {
    lines.push('✅ All pods in the cluster are running normally with no CrashLoopBackOff or errors.');
  }

  if (telemetry.ingresses.length > 0) {
    lines.push(`- **Ingress Endpoints (${telemetry.ingressCount})**:`);
    telemetry.ingresses.forEach((ing) => {
      lines.push(`  - \`${ing.name}\` (Namespace: \`${ing.namespace}\`, Host: \`${ing.host}\`, Class: \`${ing.class || 'default'}\`)`);
    });
  }

  if (argoApps.installed && argoApps.applications.length > 0) {
    lines.push(`- **ArgoCD Applications (${argoApps.applications.length})**:`);
    argoApps.applications.forEach((a) => {
      lines.push(`  - \`${a.name}\`: Health=\`${a.healthStatus}\`, Sync=\`${a.syncStatus}\`, Namespace=\`${a.destinationNamespace || 'default'}\``);
    });
  }

  lines.push(`- **Supported App Store Catalog (${APP_CATALOG.length} enablers)**:`);
  lines.push(`  ${APP_CATALOG.map((a) => a.id).join(', ')}`);

  return {
    promptContext: lines.join('\n'),
    snapshot,
  };
}
