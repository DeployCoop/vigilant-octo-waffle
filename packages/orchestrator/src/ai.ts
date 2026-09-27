import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface IncidentAnalysis {
  podName: string;
  namespace: string;
  rootCause: string;
  explanation: string;
  severity: 'critical' | 'high' | 'medium';
  suggestedFix: string;
  suggestedOverrideYaml?: string;
  engineUsed: 'ollama' | 'heuristic';
}

export async function gatherPodContext(
  namespace: string,
  podName: string,
  containerName?: string
): Promise<{ logs: string; events: string; describe: string }> {
  let logs = '';
  let events = '';
  let describe = '';

  const cFlag = containerName ? `-c ${containerName}` : '';

  try {
    const { stdout } = await execAsync(`kubectl logs -n ${namespace} ${podName} ${cFlag} --tail=100 2>/dev/null || true`);
    logs = stdout;
  } catch {}

  try {
    const { stdout } = await execAsync(
      `kubectl get events -n ${namespace} --field-selector involvedObject.name=${podName} --sort-by='.metadata.creationTimestamp' -o custom-columns=TIME:.metadata.creationTimestamp,TYPE:.type,REASON:.reason,MESSAGE:.message 2>/dev/null || true`
    );
    events = stdout;
  } catch {}

  try {
    const { stdout } = await execAsync(`kubectl describe pod -n ${namespace} ${podName} 2>/dev/null || true`);
    describe = stdout.slice(0, 2000); // limit size
  } catch {}

  return { logs, events, describe };
}

export function heuristicAnalysis(
  podName: string,
  namespace: string,
  context: { logs: string; events: string; describe: string }
): IncidentAnalysis {
  const combined = (context.logs + '\n' + context.events + '\n' + context.describe).toLowerCase();

  // Pattern 1: OOMKilled
  if (combined.includes('oomkilled') || combined.includes('out of memory')) {
    return {
      podName,
      namespace,
      rootCause: 'Container terminated due to exceeding Memory Limits (OOMKilled)',
      explanation: 'The container exceeded its configured memory limits or the cluster node ran out of RAM during high workload bursts.',
      severity: 'critical',
      suggestedFix: 'Increase memory limits in .argo_overrides or switch to a lighter deployment preset.',
      suggestedOverrideYaml: `spec:\n  template:\n    spec:\n      containers:\n        - name: app\n          resources:\n            limits:\n              memory: "1Gi"\n            requests:\n              memory: "512Mi"`,
      engineUsed: 'heuristic',
    };
  }

  // Pattern 2: ImagePullBackOff / ErrImagePull
  if (combined.includes('imagepullbackoff') || combined.includes('errimagepull') || combined.includes('manifest unknown')) {
    return {
      podName,
      namespace,
      rootCause: 'Container Image Pull Failure (ImagePullBackOff)',
      explanation: 'Kubernetes could not fetch the requested container image tag from the registry or registry credentials are required.',
      severity: 'high',
      suggestedFix: 'Verify the image repository, tag, and imagePullSecrets in the ArgoCD application manifest.',
      suggestedOverrideYaml: `spec:\n  source:\n    helm:\n      values: |\n        image:\n          tag: "latest"`,
      engineUsed: 'heuristic',
    };
  }

  // Pattern 3: Database / Network Connection Refused
  if (combined.includes('connection refused') || combined.includes('econnrefused') || combined.includes('failed to connect to database')) {
    return {
      podName,
      namespace,
      rootCause: 'Downstream Database or Service Connection Refused',
      explanation: 'The application tried connecting to an internal database or dependent service before it finished initializing.',
      severity: 'high',
      suggestedFix: 'Ensure dependent databases (e.g. Kubegres PostgreSQL or Redis) are healthy and ready, and verify credentials in .secrets/.',
      engineUsed: 'heuristic',
    };
  }

  // Pattern 4: Volume / PVC Mount Pending
  if (combined.includes('persistentvolumeclaim') || combined.includes('volume') && combined.includes('timeout')) {
    return {
      podName,
      namespace,
      rootCause: 'PersistentVolumeClaim Attachment Blocked',
      explanation: 'The pod is waiting for a Persistent Volume Claim to be provisioned and bound by the StorageClass.',
      severity: 'medium',
      suggestedFix: 'Check the Storage page to verify StorageClass local-path-storage is active and binding claims.',
      engineUsed: 'heuristic',
    };
  }

  // Generic Crash
  return {
    podName,
    namespace,
    rootCause: 'Application Runtime Crash (Process exited with non-zero status)',
    explanation: 'The process exited abnormally. Check container stdout logs for language-specific stack traces.',
    severity: 'medium',
    suggestedFix: 'Inspect environment variables and review logs in the Pod Explorer.',
    engineUsed: 'heuristic',
  };
}

export async function diagnoseIncident(
  namespace: string,
  podName: string,
  containerName?: string
): Promise<IncidentAnalysis> {
  const context = await gatherPodContext(namespace, podName, containerName);

  // Try local Ollama if running
  try {
    const prompt = `You are a Kubernetes diagnostic expert. Analyze this failing pod:
Pod: ${podName} (Namespace: ${namespace})
Events:
${context.events.slice(0, 1000)}

Logs:
${context.logs.slice(-1500)}

Respond in valid JSON with these exact keys:
"rootCause": brief headline,
"explanation": explanation of why it failed,
"severity": "critical"|"high"|"medium",
"suggestedFix": concrete step to fix,
"suggestedOverrideYaml": optional YAML patch snippet`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3:latest',
        prompt,
        stream: false,
        format: 'json',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const parsed = JSON.parse(data.response);
      return {
        podName,
        namespace,
        rootCause: parsed.rootCause || 'Diagnostic completed by local model',
        explanation: parsed.explanation || '',
        severity: parsed.severity || 'medium',
        suggestedFix: parsed.suggestedFix || '',
        suggestedOverrideYaml: parsed.suggestedOverrideYaml,
        engineUsed: 'ollama',
      };
    }
  } catch {
    // Ollama offline or timed out; smoothly fall back to heuristic
  }

  return heuristicAnalysis(podName, namespace, context);
}
