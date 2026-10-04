/**
 * Copilot tool catalog and execution, plus the cluster watchdog scan (WS6 split of antigravity.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as path from 'node:path';
import { processManager } from '../executor.js';
import { type AntigravityResponse, type AskAntigravityOptions } from './types.js';
import { askAntigravity } from './engine.js';

/**
 * Executes a prioritized Cluster Watchdog inspection across workloads,
 * ingress paths, node allocations, and ArgoCD application states.
 */
export async function runClusterWatchdogScan(
  root: string,
  options?: Partial<AskAntigravityOptions>
): Promise<AntigravityResponse> {
  const watchdogPrompt =
    'Perform a comprehensive cluster health and reliability inspection. Analyze active node resource saturation, check pod crash loops, inspect recent warning events, verify ingress routes, and highlight top 3 risk factors with concrete kubectl fix commands.';

  return askAntigravity({
    root,
    prompt: watchdogPrompt,
    provider: options?.provider || 'antigravity',
    model: options?.model,
    effort: options?.effort || 'medium',
    includeClusterContext: true,
    ...options,
  });
}

// ==============================================================================
// Autonomous Tool-Calling Agent Copilot (Phase 11 Platform Copilot)
// ==============================================================================

export interface CopilotToolParam {
  type: string;
  description: string;
  required?: boolean;
  default?: any;
}

export interface CopilotTool {
  id: string;
  name: string;
  description: string;
  category: 'remediation' | 'inspection' | 'scaling' | 'diagnostics';
  parameters: Record<string, CopilotToolParam>;
}

export const COPILOT_TOOLS: CopilotTool[] = [
  {
    id: 'run_cluster_healer',
    name: 'Autonomous Cluster Healer',
    description: 'Inspects and remediates node disk pressure, expired kubelet certs, and crash-looping workloads using deterministic runbooks.',
    category: 'remediation',
    parameters: {
      autoRemediate: { type: 'boolean', description: 'Whether to execute remediation immediately (true) or dry-run inspection (false)', default: true },
      runbook: { type: 'string', description: 'Specific runbook to execute (prune_disk, cert_renewal, bounce_crashloop)', required: false },
    },
  },
  {
    id: 'run_dr_drill',
    name: 'Disaster Recovery Game Day Drill',
    description: 'Executes an automated disaster recovery restore drill against the latest snapshot, verifying sha256 integrity and generating an SLA certificate.',
    category: 'inspection',
    parameters: {
      dryRun: { type: 'boolean', description: 'Simulate restore without writing test pods to cluster', default: false },
      namespace: { type: 'string', description: 'Target namespace for drill restore', default: 'dr-sandbox' },
    },
  },
  {
    id: 'inspect_finops',
    name: 'FinOps & P95 Right-Sizing',
    description: 'Analyzes 7-day P95 CPU/memory usage to identify over-provisioned pods and inspects real-time host NVIDIA GPU power consumption.',
    category: 'inspection',
    parameters: {},
  },
  {
    id: 'provision_hybrid_node',
    name: 'Provision Hybrid Node',
    description: 'Spawns an on-demand worker node using Multipass, libvirt, or Docker hypervisors and auto-joins it to the K3s cluster.',
    category: 'scaling',
    parameters: {
      hypervisor: { type: 'string', description: 'Target hypervisor (multipass, libvirt, docker)', default: 'multipass' },
      role: { type: 'string', description: 'Node role (agent or server)', default: 'agent' },
      cpu: { type: 'number', description: 'Number of vCPUs', default: 2 },
      memGb: { type: 'number', description: 'Memory in GB', default: 4 },
      diskGb: { type: 'number', description: 'Disk size in GB', default: 20 },
    },
  },
  {
    id: 'drain_idle_nodes',
    name: 'Drain Idle Pooled Nodes',
    description: 'Drains and scales to zero pooled worker nodes that have been idle without user workloads.',
    category: 'scaling',
    parameters: {
      maxIdleMinutes: { type: 'number', description: 'Idle timeout before draining', default: 30 },
      dryRun: { type: 'boolean', description: 'Dry run inspection without cordoning', default: false },
    },
  },
  {
    id: 'split_canary_traffic',
    name: 'Gateway API Canary Traffic Split',
    description: 'Creates or updates a Kubernetes Gateway API HTTPRoute to split traffic by percentage between stable and canary services.',
    category: 'scaling',
    parameters: {
      name: { type: 'string', description: 'Route name', required: true },
      stableService: { type: 'string', description: 'Stable service name', required: true },
      stableWeight: { type: 'number', description: 'Stable service weight percentage (0-100)', required: true },
      canaryService: { type: 'string', description: 'Canary service name', required: true },
      canaryWeight: { type: 'number', description: 'Canary service weight percentage (0-100)', required: true },
      namespace: { type: 'string', description: 'Namespace', default: 'default' },
    },
  },
  {
    id: 'kubectl_describe_pod',
    name: 'Kubectl Describe Pod',
    description: 'Fetches detailed Kubernetes events and container status for a specific pod.',
    category: 'diagnostics',
    parameters: {
      podName: { type: 'string', description: 'Pod name', required: true },
      namespace: { type: 'string', description: 'Pod namespace', default: 'default' },
    },
  },
  {
    id: 'kubectl_tail_logs',
    name: 'Kubectl Tail Logs',
    description: 'Retrieves the last 100 log lines from a pod container.',
    category: 'diagnostics',
    parameters: {
      podName: { type: 'string', description: 'Pod name', required: true },
      namespace: { type: 'string', description: 'Pod namespace', default: 'default' },
      lines: { type: 'number', description: 'Number of lines to tail', default: 100 },
    },
  },
  {
    id: 'kubectl_restart_rollout',
    name: 'Kubectl Rollout Restart',
    description: 'Triggers a graceful rolling restart of a deployment or statefulset.',
    category: 'remediation',
    parameters: {
      resourceType: { type: 'string', description: 'Resource type (deployment, statefulset, daemonset)', default: 'deployment' },
      resourceName: { type: 'string', description: 'Resource name', required: true },
      namespace: { type: 'string', description: 'Namespace', default: 'default' },
    },
  },
];

export function getCopilotTools(): CopilotTool[] {
  return COPILOT_TOOLS;
}

export async function executeCopilotTool(
  root: string,
  toolId: string,
  params: Record<string, any> = {}
): Promise<{ success: boolean; message: string; taskId?: string; data?: any }> {
  switch (toolId) {
    case 'run_cluster_healer': {
      const scriptPath = path.join(root, 'src', 'k3s_healer.sh');
      const action = params.autoRemediate !== false ? 'auto' : 'run';
      const args = [scriptPath, action];
      if (params.runbook) args.push('--runbook', String(params.runbook));
      if (params.dryRun) args.push('--dry-run');
      const task = processManager.runCommand('bash', args, { cwd: root });
      return { success: true, message: `Started Autonomous Cluster Healer (${action})`, taskId: task.id };
    }

    case 'run_dr_drill': {
      const scriptPath = path.join(root, 'src', 'k3s_dr_drill.sh');
      const args = [scriptPath, 'run'];
      if (params.dryRun) args.push('--dry-run');
      if (params.namespace) args.push('--namespace', String(params.namespace));
      const task = processManager.runCommand('bash', args, { cwd: root });
      return { success: true, message: 'Initiated Disaster Recovery Game Day drill', taskId: task.id };
    }

    case 'inspect_finops': {
      const scriptPath = path.join(root, 'src', 'k3s_finops.sh');
      const task = processManager.runCommand('bash', [scriptPath, 'right-size', '--json'], { cwd: root });
      return { success: true, message: 'Running FinOps right-sizing and GPU analysis', taskId: task.id };
    }

    case 'provision_hybrid_node': {
      const scriptPath = path.join(root, 'src', 'k3s_pool.sh');
      const args = [scriptPath, 'provision'];
      if (params.hypervisor) args.push('--hypervisor', String(params.hypervisor));
      if (params.role) args.push('--role', String(params.role));
      if (params.cpu) args.push('--cpu', String(params.cpu));
      if (params.memGb) args.push('--mem', String(params.memGb));
      if (params.diskGb) args.push('--disk', String(params.diskGb));
      const task = processManager.runCommand('bash', args, { cwd: root });
      return { success: true, message: `Provisioning dynamic hybrid node via ${params.hypervisor || 'multipass'}`, taskId: task.id };
    }

    case 'drain_idle_nodes': {
      const scriptPath = path.join(root, 'src', 'k3s_pool.sh');
      const args = [scriptPath, 'drain-idle'];
      if (params.maxIdleMinutes) args.push('--max-idle', String(params.maxIdleMinutes));
      if (params.dryRun) args.push('--dry-run');
      const task = processManager.runCommand('bash', args, { cwd: root });
      return { success: true, message: 'Draining idle pooled worker nodes', taskId: task.id };
    }

    case 'split_canary_traffic': {
      const scriptPath = path.join(root, 'src', 'k3s_gateway.sh');
      const args = [
        scriptPath,
        'create-canary',
        '--name',
        String(params.name || 'app-route'),
        '--stable-svc',
        String(params.stableService),
        '--stable-weight',
        String(params.stableWeight || 80),
        '--canary-svc',
        String(params.canaryService),
        '--canary-weight',
        String(params.canaryWeight || 20),
      ];
      if (params.namespace) args.push('--namespace', String(params.namespace));
      const task = processManager.runCommand('bash', args, { cwd: root });
      return { success: true, message: `Configuring Gateway API canary split (${params.stableWeight}% / ${params.canaryWeight}%)`, taskId: task.id };
    }

    case 'kubectl_describe_pod': {
      const podName = String(params.podName || '');
      const ns = String(params.namespace || 'default');
      const task = processManager.runCommand('kubectl', ['describe', 'pod', podName, '-n', ns], { cwd: root });
      return { success: true, message: `Describing pod ${ns}/${podName}`, taskId: task.id };
    }

    case 'kubectl_tail_logs': {
      const podName = String(params.podName || '');
      const ns = String(params.namespace || 'default');
      const lines = String(params.lines || 100);
      const task = processManager.runCommand('kubectl', ['logs', podName, '-n', ns, `--tail=${lines}`], { cwd: root });
      return { success: true, message: `Tailing logs for ${ns}/${podName}`, taskId: task.id };
    }

    case 'kubectl_restart_rollout': {
      const type = String(params.resourceType || 'deployment');
      const name = String(params.resourceName || '');
      const ns = String(params.namespace || 'default');
      const task = processManager.runCommand('kubectl', ['rollout', 'restart', `${type}/${name}`, '-n', ns], { cwd: root });
      return { success: true, message: `Rolling restart dispatched for ${type}/${name} in ${ns}`, taskId: task.id };
    }

    default:
      return { success: false, message: `Unknown Copilot tool: ${toolId}` };
  }
}
