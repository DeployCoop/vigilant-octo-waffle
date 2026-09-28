import { execFile, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { K8sClient, type ClusterTelemetry, type PodInfo, type ArgoAppStatus } from './k8s.js';
import { loadProjectConfig } from './config.js';
import { APP_CATALOG } from './registry.js';

export type AIProvider = 'antigravity' | 'ollama' | 'vllm';

export interface AIProviderInfo {
  id: AIProvider;
  name: string;
  available: boolean;
  baseUrl?: string;
  models: string[];
  defaultModel: string;
}

export interface AntigravityEngineStatus {
  available: boolean;
  binaryPath?: string;
  version?: string;
  defaultProvider: AIProvider;
  defaultModel: string;
  availableModels: string[];
  providers: Record<AIProvider, AIProviderInfo>;
  platform: string;
}

export interface AntigravityResponse {
  response: string;
  provider: AIProvider;
  modelUsed: string;
  conversationId?: string;
  durationSeconds?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    total_tokens?: number;
  };
  engineUsed: 'antigravity-cli' | 'ollama' | 'vllm' | 'cluster-copilot-engine';
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
  provider?: AIProvider;
  model?: string;
  customEndpoint?: string;
  conversationId?: string;
  effort?: 'low' | 'medium' | 'high';
  includeClusterContext?: boolean;
  root: string;
}

const DEFAULT_ANTIGRAVITY_MODELS = [
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

const DEFAULT_OLLAMA_MODELS = [
  'llama3:latest',
  'mistral:latest',
  'deepseek-r1:latest',
  'qwen2.5-coder:latest',
  'codellama:latest',
  'phi4:latest',
];

const DEFAULT_VLLM_MODELS = [
  'meta-llama/Meta-Llama-3-8B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.2',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
  'Qwen/Qwen2.5-Coder-7B-Instruct',
];

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
 * Checks if Ollama is running and retrieves installed models.
 */
export async function checkOllamaStatus(customUrl?: string): Promise<{
  available: boolean;
  models: string[];
  baseUrl: string;
}> {
  const baseUrl = (customUrl || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      const tags = (data.models || []).map((m: any) => m.name || m.model).filter(Boolean);
      return {
        available: true,
        models: tags.length > 0 ? tags : DEFAULT_OLLAMA_MODELS,
        baseUrl,
      };
    }
  } catch {}

  return {
    available: false,
    models: DEFAULT_OLLAMA_MODELS,
    baseUrl,
  };
}

/**
 * Checks if vLLM is running and retrieves served models.
 */
export async function checkVllmStatus(customUrl?: string): Promise<{
  available: boolean;
  models: string[];
  baseUrl: string;
}> {
  const baseUrl = (customUrl || process.env.VLLM_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      const models = (data.data || []).map((m: any) => m.id).filter(Boolean);
      return {
        available: true,
        models: models.length > 0 ? models : DEFAULT_VLLM_MODELS,
        baseUrl,
      };
    }
  } catch {}

  return {
    available: false,
    models: DEFAULT_VLLM_MODELS,
    baseUrl,
  };
}

/**
 * Returns current status, binary path, and models for all supported providers:
 * Antigravity (agy), Ollama, and vLLM.
 */
export async function getAntigravityEngineStatus(endpoints?: {
  ollama?: string;
  vllm?: string;
}): Promise<AntigravityEngineStatus> {
  const binary = findAgyBinary();
  const agyAvailable = Boolean(binary);
  const version = process.env.ANTIGRAVITY_LS_VERSION || 'cli-2.17.0';

  const [ollamaStatus, vllmStatus] = await Promise.all([
    checkOllamaStatus(endpoints?.ollama),
    checkVllmStatus(endpoints?.vllm),
  ]);

  const providers: Record<AIProvider, AIProviderInfo> = {
    antigravity: {
      id: 'antigravity',
      name: 'Google Antigravity (AGY)',
      available: agyAvailable,
      models: DEFAULT_ANTIGRAVITY_MODELS,
      defaultModel: 'gemini-3.8-flash-high',
    },
    ollama: {
      id: 'ollama',
      name: 'Ollama (Local / On-Prem)',
      available: ollamaStatus.available,
      baseUrl: ollamaStatus.baseUrl,
      models: ollamaStatus.models,
      defaultModel: ollamaStatus.models[0] || 'llama3:latest',
    },
    vllm: {
      id: 'vllm',
      name: 'vLLM (High-Throughput)',
      available: vllmStatus.available,
      baseUrl: vllmStatus.baseUrl,
      models: vllmStatus.models,
      defaultModel: vllmStatus.models[0] || 'meta-llama/Meta-Llama-3-8B-Instruct',
    },
  };

  return {
    available: agyAvailable || ollamaStatus.available || vllmStatus.available,
    binaryPath: binary || undefined,
    version,
    defaultProvider: agyAvailable ? 'antigravity' : ollamaStatus.available ? 'ollama' : 'antigravity',
    defaultModel: 'gemini-3.8-flash-high',
    availableModels: DEFAULT_ANTIGRAVITY_MODELS,
    providers,
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
 * Queries Ollama via REST API (`/api/chat`).
 */
async function queryOllama(options: {
  prompt: string;
  systemInstructions: string;
  model: string;
  baseUrl?: string;
}): Promise<{ response: string; usage?: any; durationSeconds: number }> {
  const baseUrl = (options.baseUrl || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
  const startTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: options.systemInstructions },
          { role: 'user', content: options.prompt },
        ],
        stream: false,
        options: {
          temperature: 0.2,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const elapsed = (Date.now() - startTime) / 1000;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama returned status ${res.status}: ${errText}`);
    }

    const data: any = await res.json();
    const content = data.message?.content || data.response || '';

    return {
      response: content.trim(),
      durationSeconds: elapsed,
      usage: {
        input_tokens: data.prompt_eval_count,
        output_tokens: data.eval_count,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  } catch (err: any) {
    clearTimeout(timeout);
    throw new Error(`Ollama connection error (${baseUrl}): ${err.message}`);
  }
}

/**
 * Queries vLLM via OpenAI-compatible REST API (`/v1/chat/completions`).
 */
async function queryVllm(options: {
  prompt: string;
  systemInstructions: string;
  model: string;
  baseUrl?: string;
}): Promise<{ response: string; usage?: any; durationSeconds: number }> {
  const baseUrl = (options.baseUrl || process.env.VLLM_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const startTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: options.systemInstructions },
          { role: 'user', content: options.prompt },
        ],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const elapsed = (Date.now() - startTime) / 1000;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`vLLM returned status ${res.status}: ${errText}`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    return {
      response: content.trim(),
      durationSeconds: elapsed,
      usage: {
        input_tokens: data.usage?.prompt_tokens,
        output_tokens: data.usage?.completion_tokens,
        total_tokens: data.usage?.total_tokens,
      },
    };
  } catch (err: any) {
    clearTimeout(timeout);
    throw new Error(`vLLM connection error (${baseUrl}): ${err.message}`);
  }
}

/**
 * Generates an intelligent cluster response if an AI backend is unreachable.
 */
function generateHeuristicResponse(
  userPrompt: string,
  snapshot: AntigravityResponse['clusterSnapshot'],
  providerName: string = 'Antigravity Copilot'
): string {
  const p = userPrompt.toLowerCase();

  if (p.includes('status') || p.includes('health') || p.includes('overview') || p.includes('nodes')) {
    return `### ${providerName} Cluster Overview

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
  return `### ${providerName}

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
 * Main query method supporting:
 * - Antigravity (`agy` CLI)
 * - Ollama (`/api/chat` REST)
 * - vLLM (`/v1/chat/completions` REST)
 * - Automatic Heuristic Cluster Copilot fallback
 */
export async function askAntigravity(options: AskAntigravityOptions): Promise<AntigravityResponse> {
  const {
    prompt,
    provider = 'antigravity',
    model,
    customEndpoint,
    conversationId,
    effort = 'low',
    includeClusterContext = true,
    root,
  } = options;

  const { promptContext, snapshot } = await buildClusterContext(root);

  const systemInstructions = `You are the AI DevOps and Kubernetes Copilot for the Vigilant Octo Waffle local control plane.

${includeClusterContext ? promptContext : ''}

Instructions:
1. Provide accurate, clear, and actionable DevOps / Kubernetes answers.
2. When suggesting commands, use standard markdown code blocks (e.g. \`\`\`bash\nkubectl ...\n\`\`\`).
3. Use markdown tables, bold headings, and bullet points to structure your output cleanly.
4. Reference the live cluster state above whenever the user asks about cluster health, pods, nodes, or applications.
5. If there are any failing pods or misconfigurations, provide the exact cause and step-by-step remediation.`;

  // 1. Ollama Provider
  if (provider === 'ollama') {
    const targetModel = model || 'llama3:latest';
    try {
      const ollamaRes = await queryOllama({
        prompt,
        systemInstructions,
        model: targetModel,
        baseUrl: customEndpoint,
      });

      return {
        response: ollamaRes.response,
        provider: 'ollama',
        modelUsed: targetModel,
        conversationId: conversationId || `conv_ollama_${Date.now()}`,
        durationSeconds: ollamaRes.durationSeconds,
        usage: ollamaRes.usage,
        engineUsed: 'ollama',
        clusterSnapshot: snapshot,
      };
    } catch (err: any) {
      const endpoint = customEndpoint || 'http://localhost:11434';
      const fallbackText = `> ⚠️ **Ollama Offline**: Could not connect to Ollama at \`${endpoint}\` (${err.message}).
> Ensure Ollama is running (\`ollama serve\`) and that model \`${targetModel}\` is downloaded (\`ollama pull ${targetModel}\`).
> Showing local cluster copilot analysis instead:

${generateHeuristicResponse(prompt, snapshot, 'Ollama (Heuristic Fallback)')}`;

      return {
        response: fallbackText,
        provider: 'ollama',
        modelUsed: targetModel,
        conversationId: conversationId || `conv_${Date.now()}`,
        durationSeconds: 0.1,
        engineUsed: 'cluster-copilot-engine',
        clusterSnapshot: snapshot,
      };
    }
  }

  // 2. vLLM Provider
  if (provider === 'vllm') {
    const targetModel = model || 'meta-llama/Meta-Llama-3-8B-Instruct';
    try {
      const vllmRes = await queryVllm({
        prompt,
        systemInstructions,
        model: targetModel,
        baseUrl: customEndpoint,
      });

      return {
        response: vllmRes.response,
        provider: 'vllm',
        modelUsed: targetModel,
        conversationId: conversationId || `conv_vllm_${Date.now()}`,
        durationSeconds: vllmRes.durationSeconds,
        usage: vllmRes.usage,
        engineUsed: 'vllm',
        clusterSnapshot: snapshot,
      };
    } catch (err: any) {
      const endpoint = customEndpoint || 'http://localhost:8000';
      const fallbackText = `> ⚠️ **vLLM Offline**: Could not connect to vLLM at \`${endpoint}\` (${err.message}).
> Ensure your vLLM server is running (e.g. \`vllm serve ${targetModel} --port 8000\`).
> Showing local cluster copilot analysis instead:

${generateHeuristicResponse(prompt, snapshot, 'vLLM (Heuristic Fallback)')}`;

      return {
        response: fallbackText,
        provider: 'vllm',
        modelUsed: targetModel,
        conversationId: conversationId || `conv_${Date.now()}`,
        durationSeconds: 0.1,
        engineUsed: 'cluster-copilot-engine',
        clusterSnapshot: snapshot,
      };
    }
  }

  // 3. Default: Google Antigravity (agy CLI)
  const agyBinary = findAgyBinary();
  const targetModel = model || 'gemini-3.8-flash-high';

  if (!agyBinary) {
    const fallbackText = generateHeuristicResponse(prompt, snapshot, 'Antigravity Copilot');
    return {
      response: fallbackText,
      provider: 'antigravity',
      modelUsed: targetModel,
      conversationId: conversationId || `conv_${Date.now()}`,
      durationSeconds: 0.1,
      engineUsed: 'cluster-copilot-engine',
      clusterSnapshot: snapshot,
    };
  }

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
      (err, stdout) => {
        const elapsed = (Date.now() - startTime) / 1000;

        if (err || !stdout.trim()) {
          const fallbackText = generateHeuristicResponse(prompt, snapshot, 'Antigravity Copilot');
          return resolve({
            response: fallbackText,
            provider: 'antigravity',
            modelUsed: targetModel,
            conversationId: conversationId || `conv_${Date.now()}`,
            durationSeconds: elapsed,
            engineUsed: 'cluster-copilot-engine',
            clusterSnapshot: snapshot,
          });
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          const responseText = parsed.response || parsed.text || '';

          if (!responseText.trim()) {
            const fallbackText = generateHeuristicResponse(prompt, snapshot, 'Antigravity Copilot');
            return resolve({
              response: fallbackText,
              provider: 'antigravity',
              modelUsed: targetModel,
              conversationId: parsed.conversation_id || conversationId,
              durationSeconds: parsed.duration_seconds || elapsed,
              usage: parsed.usage,
              engineUsed: 'cluster-copilot-engine',
              clusterSnapshot: snapshot,
            });
          }

          resolve({
            response: responseText.trim(),
            provider: 'antigravity',
            modelUsed: targetModel,
            conversationId: parsed.conversation_id || conversationId,
            durationSeconds: parsed.duration_seconds || elapsed,
            usage: parsed.usage,
            engineUsed: 'antigravity-cli',
            clusterSnapshot: snapshot,
          });
        } catch {
          resolve({
            response: stdout.trim(),
            provider: 'antigravity',
            modelUsed: targetModel,
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
