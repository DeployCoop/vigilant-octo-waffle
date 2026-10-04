/**
 * AI query engine: provider queries, manifest-patch detection, heuristic fallback, ask/stream APIs (WS6 split of antigravity.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { APP_CATALOG } from '../registry.js';
import { type AIProvider, type DetectedManifest, type StreamEvent, type AntigravityResponse, type AskAntigravityOptions, type StreamAntigravityOptions } from './types.js';
import { findAgyBinary } from './providers.js';
import { buildClusterContext } from './context.js';

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
 * Scans markdown text for valid Kubernetes / ArgoCD YAML manifests.
 * Extracts kind, metadata name/namespace, and correlates with known apps from APP_CATALOG.
 */
export function detectManifestPatch(markdown: string): DetectedManifest[] {
  const manifests: DetectedManifest[] = [];
  if (!markdown) return manifests;

  // Match ```yaml or ```yml or ``` containing YAML blocks
  const codeBlockRegex = /```(?:ya?ml)?\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    const rawBlock = match[1].trim();
    if (!rawBlock) continue;

    // A block might contain multiple YAML docs separated by ---
    const docs = rawBlock.split(/^---$/m).map((d) => d.trim()).filter(Boolean);

    for (const raw of docs) {
      const hasKind = /(?:^|\n)\s*kind:\s*([A-Za-z0-9_-]+)/.test(raw);
      const hasApiVersion = /(?:^|\n)\s*apiVersion:\s*([A-Za-z0-9_/.-]+)/.test(raw);
      const hasMetadata = /(?:^|\n)\s*metadata:\s*/.test(raw);
      const hasSpec = /(?:^|\n)\s*spec:\s*/.test(raw);

      if ((hasKind && hasMetadata) || (hasApiVersion && (hasKind || hasMetadata)) || (hasSpec && hasMetadata)) {
        const kindMatch = /(?:^|\n)\s*kind:\s*([A-Za-z0-9_-]+)/.exec(raw);
        const nameMatch = /(?:^|\n)\s*name:\s*([A-Za-z0-9_.-]+)/.exec(raw);
        const nsMatch = /(?:^|\n)\s*namespace:\s*([A-Za-z0-9_.-]+)/.exec(raw);

        const kind = kindMatch ? kindMatch[1] : undefined;
        const name = nameMatch ? nameMatch[1] : undefined;
        const namespace = nsMatch ? nsMatch[1] : undefined;
        const isArgoApp = kind?.toLowerCase() === 'application' || raw.includes('argoproj.io');

        // Check against APP_CATALOG
        let targetAppId: string | undefined;
        const lowerRaw = raw.toLowerCase();
        const lowerName = name?.toLowerCase() || '';

        for (const app of APP_CATALOG) {
          if (
            lowerName.includes(app.id) ||
            app.id.includes(lowerName) ||
            lowerRaw.includes(`argo/${app.id}`) ||
            lowerRaw.includes(`charts/${app.id}`) ||
            lowerRaw.includes(`.argo_overrides/${app.id}`) ||
            lowerRaw.includes(`.flux_overrides/${app.id}`)
          ) {
            targetAppId = app.id;
            break;
          }
        }

        manifests.push({
          raw,
          kind,
          name,
          namespace,
          targetAppId,
          isArgoApp,
        });
      }
    }
  }

  return manifests;
}

/**
 * Emits progressive typewriter-style streaming chunks for fallback and offline responses.
 */
async function streamFallbackText(
  text: string,
  snapshot: AntigravityResponse['clusterSnapshot'],
  provider: AIProvider,
  model: string,
  onEvent: (event: StreamEvent) => void
): Promise<AntigravityResponse> {
  const chunks = text.match(/[\s\S]{1,25}/g) || [text];
  for (const chunk of chunks) {
    onEvent({ type: 'chunk', text: chunk });
    await new Promise((r) => setTimeout(r, 8));
  }

  const manifests = detectManifestPatch(text);
  for (const manifest of manifests) {
    onEvent({ type: 'manifest', manifest });
  }

  const res: AntigravityResponse = {
    response: text,
    provider,
    modelUsed: model,
    durationSeconds: 0.1,
    engineUsed: 'cluster-copilot-engine',
    clusterSnapshot: snapshot,
  };

  onEvent({ type: 'done', response: res });
  return res;
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

/**
 * Real-time streaming interface for Antigravity, Ollama, and vLLM.
 * Emits progressive status updates, incremental token chunks, detected YAML manifests,
 * and the final aggregated response.
 */
export async function streamAntigravity(
  options: StreamAntigravityOptions,
  onEvent: (event: StreamEvent) => void
): Promise<AntigravityResponse> {
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

  onEvent({
    type: 'status',
    statusMessage: `Connecting to ${provider === 'antigravity' ? 'Google Antigravity' : provider.toUpperCase()}...`,
  });

  const { promptContext, snapshot } = await buildClusterContext(root);

  onEvent({
    type: 'status',
    statusMessage: `Gathered cluster context (${snapshot.platform.toUpperCase()}, ${snapshot.nodeCount} nodes, ${snapshot.podCount} pods)`,
  });

  const systemInstructions = `You are the AI DevOps and Kubernetes Copilot for the Vigilant Octo Waffle local control plane.

${includeClusterContext ? promptContext : ''}

Instructions:
1. Provide accurate, clear, and actionable DevOps / Kubernetes answers.
2. When suggesting commands, use standard markdown code blocks (e.g. \`\`\`bash\nkubectl ...\n\`\`\`).
3. When suggesting manifests, patch configurations, or overrides, use \`\`\`yaml\n...code...\n\`\`\` blocks with valid Kubernetes / ArgoCD syntax.
4. Use markdown tables, bold headings, and bullet points to structure your output cleanly.
5. Reference the live cluster state above whenever the user asks about cluster health, pods, nodes, or applications.
6. If there are any failing pods or misconfigurations, provide the exact cause and step-by-step remediation.`;

  // 1. Ollama Provider Streaming
  if (provider === 'ollama') {
    const targetModel = model || 'llama3:latest';
    const baseUrl = (customEndpoint || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');
    const startTime = Date.now();

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemInstructions },
            { role: 'user', content: prompt },
          ],
          stream: true,
          options: { temperature: 0.2 },
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Ollama HTTP status ${res.status}`);
      }

      let aggregatedText = '';
      let usage: any = undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const data = JSON.parse(trimmed);
            const delta = data.message?.content || data.response || '';
            if (delta) {
              aggregatedText += delta;
              onEvent({ type: 'chunk', text: delta });
            }
            if (data.done) {
              usage = {
                input_tokens: data.prompt_eval_count,
                output_tokens: data.eval_count,
                total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
              };
            }
          } catch {}
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      const manifests = detectManifestPatch(aggregatedText);
      for (const m of manifests) {
        onEvent({ type: 'manifest', manifest: m });
      }

      const responseObj: AntigravityResponse = {
        response: aggregatedText.trim(),
        provider: 'ollama',
        modelUsed: targetModel,
        conversationId: conversationId || `conv_ollama_${Date.now()}`,
        durationSeconds: elapsed,
        usage,
        engineUsed: 'ollama',
        clusterSnapshot: snapshot,
      };

      onEvent({ type: 'done', response: responseObj });
      return responseObj;
    } catch (err: any) {
      const fallback = `> ⚠️ **Ollama Offline**: Could not connect to Ollama at \`${baseUrl}\` (${err.message}).
> Ensure Ollama is running (\`ollama serve\`) and that model \`${targetModel}\` is downloaded.
> Showing local cluster copilot analysis instead:

${generateHeuristicResponse(prompt, snapshot, 'Ollama (Heuristic Fallback)')}`;

      return streamFallbackText(fallback, snapshot, 'ollama', targetModel, onEvent);
    }
  }

  // 2. vLLM Provider Streaming
  if (provider === 'vllm') {
    const targetModel = model || 'meta-llama/Meta-Llama-3-8B-Instruct';
    const baseUrl = (customEndpoint || process.env.VLLM_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
    const startTime = Date.now();

    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            { role: 'system', content: systemInstructions },
            { role: 'user', content: prompt },
          ],
          stream: true,
          temperature: 0.2,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`vLLM HTTP status ${res.status}`);
      }

      let aggregatedText = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              const delta = data.choices?.[0]?.delta?.content || '';
              if (delta) {
                aggregatedText += delta;
                onEvent({ type: 'chunk', text: delta });
              }
            } catch {}
          }
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      const manifests = detectManifestPatch(aggregatedText);
      for (const m of manifests) {
        onEvent({ type: 'manifest', manifest: m });
      }

      const responseObj: AntigravityResponse = {
        response: aggregatedText.trim(),
        provider: 'vllm',
        modelUsed: targetModel,
        conversationId: conversationId || `conv_vllm_${Date.now()}`,
        durationSeconds: elapsed,
        engineUsed: 'vllm',
        clusterSnapshot: snapshot,
      };

      onEvent({ type: 'done', response: responseObj });
      return responseObj;
    } catch (err: any) {
      const fallback = `> ⚠️ **vLLM Offline**: Could not connect to vLLM at \`${baseUrl}\` (${err.message}).
> Ensure your vLLM server is running (e.g. \`vllm serve ${targetModel} --port 8000\`).
> Showing local cluster copilot analysis instead:

${generateHeuristicResponse(prompt, snapshot, 'vLLM (Heuristic Fallback)')}`;

      return streamFallbackText(fallback, snapshot, 'vllm', targetModel, onEvent);
    }
  }

  // 3. Default: Google Antigravity (agy CLI stream-json)
  const agyBinary = findAgyBinary();
  const targetModel = model || 'gemini-3.8-flash-high';

  if (!agyBinary) {
    const fallbackText = generateHeuristicResponse(prompt, snapshot, 'Antigravity Copilot');
    return streamFallbackText(fallbackText, snapshot, 'antigravity', targetModel, onEvent);
  }

  const fullPrompt = `${systemInstructions}\n\nUser Question:\n${prompt}`;
  const args: string[] = ['--dangerously-skip-permissions', '--effort', effort, '--output-format', 'stream-json'];

  if (conversationId) {
    args.push('--conversation', conversationId);
  }
  if (model) {
    args.push('--model', model);
  }
  args.push('-p', fullPrompt);

  return new Promise<AntigravityResponse>((resolve) => {
    const startTime = Date.now();
    let aggregatedText = '';
    let resultData: any = null;
    let buffer = '';

    const proc = spawn(agyBinary, args, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${path.dirname(agyBinary)}:${process.env.PATH || ''}`,
      },
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
    }, 60000);

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.event === 'step_update') {
            const delta = parsed.step_update?.text_delta;
            if (delta) {
              aggregatedText += delta;
              onEvent({ type: 'chunk', text: delta });
            }
          } else if (parsed.event === 'result') {
            resultData = parsed.result;
            if (resultData?.response && !aggregatedText) {
              aggregatedText = resultData.response;
              onEvent({ type: 'chunk', text: aggregatedText });
            }
          }
        } catch {
          // If non-JSON text output
          aggregatedText += trimmed + '\n';
          onEvent({ type: 'chunk', text: trimmed + '\n' });
        }
      }
    });

    proc.stderr.on('data', () => {
      // Ignore or log stderr
    });

    proc.on('close', () => {
      clearTimeout(timeout);
      const elapsed = (Date.now() - startTime) / 1000;

      if (!aggregatedText.trim()) {
        const fallbackText = generateHeuristicResponse(prompt, snapshot, 'Antigravity Copilot');
        streamFallbackText(fallbackText, snapshot, 'antigravity', targetModel, onEvent).then(resolve);
        return;
      }

      const manifests = detectManifestPatch(aggregatedText);
      for (const m of manifests) {
        onEvent({ type: 'manifest', manifest: m });
      }

      const finalRes: AntigravityResponse = {
        response: aggregatedText.trim(),
        provider: 'antigravity',
        modelUsed: targetModel,
        conversationId: resultData?.conversation_id || conversationId || `conv_${Date.now()}`,
        durationSeconds: resultData?.duration_seconds || elapsed,
        usage: resultData?.usage,
        engineUsed: 'antigravity-cli',
        clusterSnapshot: snapshot,
      };

      onEvent({ type: 'done', response: finalRes });
      resolve(finalRes);
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      const fallbackText = generateHeuristicResponse(prompt, snapshot, 'Antigravity Copilot');
      streamFallbackText(fallbackText, snapshot, 'antigravity', targetModel, onEvent).then(resolve);
    });
  });
}
