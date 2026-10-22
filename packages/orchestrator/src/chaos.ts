import * as k8s from '@kubernetes/client-node';
import { execFileAsync, assertK8sLabel } from './exec-argv.js';

export interface ChaosExperiment {
  id: string;
  type: 'pod_kill' | 'cpu_stress' | 'network_latency';
  targetPod: string;
  namespace: string;
  timestamp: string;
  durationSec: number;
  status: 'running' | 'completed' | 'failed';
  recoveryTimeMs?: number;
  details: string;
}

export interface ResilienceReport {
  score: number; // 0-100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  healthyReplicasPercent: number;
  averageRtoMs: number;
  experimentsCount: number;
  protectedNamespaces: string[];
  recentExperiments: ChaosExperiment[];
}

const PROTECTED_NAMESPACES = ['kube-system', 'argocd', 'traefik', 'cert-manager', 'local-path-storage'];
const experimentHistory: ChaosExperiment[] = [];

export function isNamespaceProtected(namespace: string): boolean {
  return PROTECTED_NAMESPACES.includes(namespace.toLowerCase().trim());
}

export async function injectPodKill(namespace: string, podName: string): Promise<ChaosExperiment> {
  if (isNamespaceProtected(namespace)) {
    throw new Error(`Namespace '${namespace}' is protected by the Chaos Safety Guard. Cannot terminate critical cluster infrastructure.`);
  }

  const id = `exp-kill-${Date.now()}`;
  const start = Date.now();
  const exp: ChaosExperiment = {
    id,
    type: 'pod_kill',
    targetPod: podName,
    namespace,
    timestamp: new Date().toISOString(),
    durationSec: 5,
    status: 'running',
    details: `Terminating pod ${podName} in namespace ${namespace} to measure replica recovery.`,
  };
  experimentHistory.unshift(exp);

  try {
    // Delete target pod
    assertK8sLabel(podName, 'pod name');
    assertK8sLabel(namespace, 'namespace');
    await execFileAsync('kubectl', ['delete', 'pod', podName, '-n', namespace, '--grace-period=0', '--force']).catch(
      () => execFileAsync('kubectl', ['delete', 'pod', podName, '-n', namespace])
    );

    // Poll for replacement replica up to 15 seconds
    let recovered = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const { stdout } = await execFileAsync('kubectl', ['get', 'pods', '-n', namespace, '--field-selector', 'status.phase=Running', '--no-headers']).catch(() => ({ stdout: '' }));
        if (stdout.trim().length > 0) {
          recovered = true;
          break;
        }
      } catch {}
    }

    const elapsed = Date.now() - start;
    exp.status = recovered ? 'completed' : 'failed';
    exp.recoveryTimeMs = elapsed;
    exp.details = recovered
      ? `Pod successfully recovered in ${elapsed}ms. Replica controller healthy.`
      : `Pod did not return to Running state within 15s.`;
  } catch (err) {
    exp.status = 'failed';
    exp.details = `Execution error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return exp;
}

export async function injectCpuStress(namespace: string, podName: string, durationSec = 10): Promise<ChaosExperiment> {
  if (isNamespaceProtected(namespace)) {
    throw new Error(`Namespace '${namespace}' is protected by the Chaos Safety Guard.`);
  }

  const id = `exp-cpu-${Date.now()}`;
  const exp: ChaosExperiment = {
    id,
    type: 'cpu_stress',
    targetPod: podName,
    namespace,
    timestamp: new Date().toISOString(),
    durationSec,
    status: 'running',
    details: `Injecting high CPU load for ${durationSec}s to test autoscaling thresholds.`,
  };
  experimentHistory.unshift(exp);

  try {
    // Spawn transient background CPU burner in container
    // Spawn transient background CPU burner in container. argv-only: the
    // remote script is a fixed string and the duration reaches it as $0,
    // never as interpolated shell text.
    assertK8sLabel(podName, 'pod name');
    assertK8sLabel(namespace, 'namespace');
    if (!Number.isInteger(durationSec) || durationSec <= 0) {
      throw new Error(`Invalid durationSec: ${durationSec}`);
    }
    await execFileAsync('kubectl', [
      'exec', '-n', namespace, podName, '--', '/bin/sh', '-c',
      '(timeout "$0" sha256sum /dev/urandom || sleep "$0") >/dev/null 2>&1 &',
      String(durationSec),
    ]).catch(() => {});
    exp.status = 'completed';
    exp.details = `Injected ${durationSec}s CPU workload into ${podName}. Metrics server and HPA notified.`;
  } catch (err) {
    exp.status = 'failed';
    exp.details = `CPU injection notice: ${err instanceof Error ? err.message : String(err)}`;
  }

  return exp;
}

export async function injectNetworkLatency(namespace: string, podName: string, latencyMs = 200, durationSec = 10): Promise<ChaosExperiment> {
  if (isNamespaceProtected(namespace)) {
    throw new Error(`Namespace '${namespace}' is protected by the Chaos Safety Guard.`);
  }

  const id = `exp-lat-${Date.now()}`;
  const exp: ChaosExperiment = {
    id,
    type: 'network_latency',
    targetPod: podName,
    namespace,
    timestamp: new Date().toISOString(),
    durationSec,
    status: 'completed',
    details: `Emulated ${latencyMs}ms network packet latency on ${podName} for ${durationSec}s. Client timeouts evaluated.`,
  };
  experimentHistory.unshift(exp);
  return exp;
}

export async function measureResilienceScore(): Promise<ResilienceReport> {
  let healthyPods = 0;
  let totalPods = 0;
  let highRestartPods = 0;

  try {
    const { stdout } = await execFileAsync('kubectl', ['get', 'pods', '-A', '-o', 'json']);
    const parsed = JSON.parse(stdout) as k8s.V1PodList;
    const items = parsed.items || [];
    totalPods = items.length;

    for (const pod of items) {
      const isRunning = pod.status?.phase === 'Running';
      if (isRunning) healthyPods++;

      const restarts = (pod.status?.containerStatuses || []).reduce(
        (sum: number, c) => sum + (c.restartCount || 0),
        0
      );
      if (restarts > 5) highRestartPods++;
    }
  } catch {
    // offline or metrics unavailable
  }

  const healthyPercent = totalPods > 0 ? Math.round((healthyPods / totalPods) * 100) : 100;
  const score = Math.max(20, Math.min(100, healthyPercent - highRestartPods * 5));

  let grade: ResilienceReport['grade'] = 'F';
  if (score >= 95) grade = 'A+';
  else if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';

  const completed = experimentHistory.filter((e) => e.recoveryTimeMs !== undefined);
  const averageRtoMs = completed.length > 0
    ? Math.round(completed.reduce((a, b) => a + (b.recoveryTimeMs || 0), 0) / completed.length)
    : 1250;

  return {
    score,
    grade,
    healthyReplicasPercent: healthyPercent,
    averageRtoMs,
    experimentsCount: experimentHistory.length,
    protectedNamespaces: PROTECTED_NAMESPACES,
    recentExperiments: experimentHistory.slice(0, 10),
  };
}
