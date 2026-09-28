import { execFile, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { K8sClient, type ClusterTelemetry, type PodInfo, type ArgoAppStatus } from './k8s.js';
import { loadProjectConfig } from './config.js';
import { APP_CATALOG } from './registry.js';

export interface AntigravityEngineStatus {
  available: boolean;
  binaryPath?: string;
  version?: string;
  defaultModel: string;
  availableModels: string[];
  platform: string;
}

export interface AntigravityResponse {
  response: string;
  conversationId?: string;
  durationSeconds?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    total_tokens?: number;
  };
  engineUsed: 'antigravity-cli' | 'cluster-copilot-engine';
  clusterSnapshot: {
    connected: boolean;
    context: string;
    platform: string;
    nodeCount: number;
    podCount: number;
    unhealthyPods: string[];
    applicationsCount: number;
  };
}

export interface AskAntigravityOptions {
  prompt: string;
  conversationId?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  includeClusterContext?: boolean;
  root: string;
}

/**
 * Searches common locations for the Antigravity CLI binary (`agy`).
 */
export function findAgyBinary(): string | null {
  if (process.env.ANTIGRAVITY_AGENTAPI_EXE && fs.existsSync(process.env.ANTIGRAVITY_AGENTAPI_EXE)) {
    return process.env.ANTIGRAVITY_AGENTAPI_EXE;
  }

  const home = process.env.HOME || '';
  const candidates = [
    path.join(home, '.local', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/usr/bin/agy',
    path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  try {
    const which = execSync('which agy 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (which && fs.existsSync(which)) {
      return which;
    }
  } catch {}

  return null;
}

/**
 * Returns current status, binary path, and models for Antigravity engine.
 */
export function getAntigravityEngineStatus(): AntigravityEngineStatus {
  const binary = findAgyBinary();
  const available = Boolean(binary);
  const version = process.env.ANTIGRAVITY_LS_VERSION || 'cli-2.17.0';

  const availableModels = [
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-low',
    'gemini-3.7-flash-high',
    'gemini-3.7-flash-medium',
    'gemini-3.1-pro-high',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'gpt-oss-120b-medium',
  ];

  return {
    available,
    binaryPath: binary || undefined,
    version,
    defaultModel: 'gemini-3.8-flash-high',
    availableModels,
    platform: process.platform,
  };
}

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

/**
 * Generates an intelligent cluster response if agy is unavailable.
 */
function generateHeuristicResponse(
  userPrompt: string,
  snapshot: AntigravityResponse['clusterSnapshot'],
  clusterMarkdown: string
): string {
  const p = userPrompt.toLowerCase();

  if (p.includes('status') || p.includes('health') || p.includes('overview') || p.includes('nodes')) {
    return `### Antigravity Cluster Overview

${snapshot.connected ? `The Kubernetes cluster is currently **Online** and healthy.` : `The Kubernetes cluster is currently **Offline / Disconnected**.`}

| Metric | Current State |
| :--- | :--- |
| **Context** | \`${snapshot.context}\` |
| **Platform** | **${snapshot.platform.toUpperCase()}** |
| **Nodes** | **${snapshot.nodeCount}** active nodes |
| **Pods** | **${snapshot.podCount}** pods |
| **Unhealthy Pods** | **${snapshot.unhealthyPods.length}** issues detected |
| **Catalog Apps** | **${snapshot.applicationsCount}** enablers available |

${snapshot.unhealthyPods.length > 0 ? `⚠️ **Attention Required**: Detected ${snapshot.unhealthyPods.length} failing pods:\n${snapshot.unhealthyPods.map((s) => `- \`${s}\``).join('\n')}\n\nRun \`kubectl describe pod <name>\` or inspect logs in the Pod Explorer to debug.` : `✅ All workloads are operating within expected parameters.`}

**Useful Quick Actions:**
\`\`\`bash
# Inspect all cluster pods
kubectl get pods -A

# Check nodes and capacity
kubectl get nodes -o wide
\`\`\``;
  }

  if (p.includes('pod') || p.includes('fail') || p.includes('error') || p.includes('crash')) {
    if (snapshot.unhealthyPods.length > 0) {
      return `### Unhealthy Workloads Analysis

Detected **${snapshot.unhealthyPods.length}** pod(s) requiring attention:

${snapshot.unhealthyPods.map((s) => `- ❌ \`${s}\``).join('\n')}

**Recommended Debugging Steps:**
1. Check the recent container termination reason:
\`\`\`bash
kubectl get pods -A --field-selector=status.phase!=Running
\`\`\`
2. Inspect events on the failing pod:
\`\`\`bash
kubectl describe pod ${snapshot.unhealthyPods[0]?.split(' ')[0] || '<pod-name>'}
\`\`\`
3. Tail pod logs to identify stack traces or missing configuration:
\`\`\`bash
kubectl logs -n ${snapshot.unhealthyPods[0]?.split('/')[0] || 'default'} ${snapshot.unhealthyPods[0]?.split('/')[1]?.split(' ')[0] || '<pod-name>'} --tail=100
\`\`\``;
    }

    return `### Pod Health Status

✅ There are currently **no failing pods** in the cluster. All **${snapshot.podCount}** pods are in Ready / Running status.

You can view full container logs and exec into containers on the **[Pod Explorer & Shell](/pods)** page.`;
  }

  if (p.includes('scale') || p.includes('k3s') || p.includes('join') || p.includes('add node')) {
    return `### Scaling & Adding Nodes to the Cluster

You are running **${snapshot.platform.toUpperCase()}**. Here is how to scale or attach nodes:

#### For K3s:
To attach an additional worker or control-plane node:
1. Open **[Cluster Control](/cluster)** and click **"+ Add K3s Node"**.
2. Retrieve the node join token:
\`\`\`bash
sudo cat /var/lib/rancher/k3s/server/node-token
\`\`\`
3. On the new machine, run the join command:
\`\`\`bash
curl -sfL https://get.k3s.io | K3S_URL=https://<SERVER_IP>:6443 K3S_TOKEN=<TOKEN> sh -
\`\`\`

#### For KinD:
KinD multi-node clusters are specified in \`src/kind-config.tpl\`. Re-run \`./up\` after editing node topology.`;
  }

  // General fallback answer
  return `### Antigravity Cluster Copilot

I have received your request regarding: *"**${userPrompt.trim()}**"*.

#### Current Cluster Context:
- **Connection**: ${snapshot.connected ? `Connected to \`${snapshot.context}\`` : 'Disconnected'}
- **Platform**: ${snapshot.platform.toUpperCase()}
- **Live Nodes**: ${snapshot.nodeCount}
- **Active Pods**: ${snapshot.podCount}

\`\`\`bash
# Run a quick sanity check across the cluster
kubectl get nodes,pods -A
\`\`\`

Need specific details on certificates, ArgoCD applications, network security, or database storage? Ask me anything about your cluster!`;
}

/**
 * Main query method for Antigravity AI.
 * Gathers cluster context, formats the prompt, invokes `agy` CLI,
 * and parses the response. Falls back gracefully if `agy` is unavailable.
 */
export async function askAntigravity(options: AskAntigravityOptions): Promise<AntigravityResponse> {
  const { prompt, conversationId, model, effort = 'low', includeClusterContext = true, root } = options;

  const { promptContext, snapshot } = await buildClusterContext(root);

  const agyBinary = findAgyBinary();

  if (!agyBinary) {
    const fallbackText = generateHeuristicResponse(prompt, snapshot, promptContext);
    return {
      response: fallbackText,
      conversationId: conversationId || `conv_${Date.now()}`,
      durationSeconds: 0.1,
      engineUsed: 'cluster-copilot-engine',
      clusterSnapshot: snapshot,
    };
  }

  const systemInstructions = `You are Antigravity, the AI DevOps and Kubernetes Copilot for the Vigilant Octo Waffle local control plane.

${includeClusterContext ? promptContext : ''}

Instructions:
1. Provide accurate, clear, and actionable DevOps / Kubernetes answers.
2. When suggesting commands, use standard markdown code blocks (e.g. \`\`\`bash\nkubectl ...\n\`\`\`).
3. Use markdown tables, bold headings, and bullet points to structure your output cleanly.
4. Reference the live cluster state above whenever the user asks about cluster health, pods, nodes, or applications.
5. If there are any failing pods or misconfigurations, provide the exact cause and step-by-step remediation.`;

  const fullPrompt = `${systemInstructions}\n\nUser Question:\n${prompt}`;

  const args: string[] = ['--dangerously-skip-permissions', '--effort', effort, '--output-format', 'json'];

  if (conversationId) {
    args.push('--conversation', conversationId);
  }

  if (model) {
    args.push('--model', model);
  }

  args.push('-p', fullPrompt);

  return new Promise<AntigravityResponse>((resolve) => {
    const startTime = Date.now();

    execFile(
      agyBinary,
      args,
      {
        cwd: root,
        timeout: 45000,
        env: {
          ...process.env,
          PATH: `${path.dirname(agyBinary)}:${process.env.PATH || ''}`,
        },
      },
      (err, stdout, stderr) => {
        const elapsed = (Date.now() - startTime) / 1000;

        if (err || !stdout.trim()) {
          const fallbackText = generateHeuristicResponse(prompt, snapshot, promptContext);
          return resolve({
            response: fallbackText,
            conversationId: conversationId || `conv_${Date.now()}`,
            durationSeconds: elapsed,
            engineUsed: 'cluster-copilot-engine',
            clusterSnapshot: snapshot,
          });
        }

        try {
          // Parse JSON output from agy
          const parsed = JSON.parse(stdout.trim());
          const responseText = parsed.response || parsed.text || '';

          if (!responseText.trim()) {
            const fallbackText = generateHeuristicResponse(prompt, snapshot, promptContext);
            return resolve({
              response: fallbackText,
              conversationId: parsed.conversation_id || conversationId,
              durationSeconds: parsed.duration_seconds || elapsed,
              usage: parsed.usage,
              engineUsed: 'cluster-copilot-engine',
              clusterSnapshot: snapshot,
            });
          }

          resolve({
            response: responseText.trim(),
            conversationId: parsed.conversation_id || conversationId,
            durationSeconds: parsed.duration_seconds || elapsed,
            usage: parsed.usage,
            engineUsed: 'antigravity-cli',
            clusterSnapshot: snapshot,
          });
        } catch {
          // In case stdout was plain text rather than JSON
          resolve({
            response: stdout.trim(),
            conversationId: conversationId || `conv_${Date.now()}`,
            durationSeconds: elapsed,
            engineUsed: 'antigravity-cli',
            clusterSnapshot: snapshot,
          });
        }
      }
    );
  });
}
