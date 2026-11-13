import { processManager } from './executor.js';

export interface PodMetric {
  name: string;
  namespace: string;
  cpuMillicores: number;
  memoryMb: number;
  timestamp: string;
}

export interface NodeMetric {
  name: string;
  cpuMillicores: number;
  cpuPercent?: number;
  memoryMb: number;
  memoryPercent?: number;
}

export interface SparklinePoint {
  time: string;
  cpu: number;
  memory: number;
}

// In-memory rolling history for sparklines
const podMetricHistory = new Map<string, SparklinePoint[]>();
const MAX_HISTORY_POINTS = 15;

export function parseCpuToMillicores(val: string): number {
  if (!val) return 0;
  if (val.endsWith('n')) {
    return Math.round(parseFloat(val) / 1000000);
  }
  if (val.endsWith('m')) {
    return Math.round(parseFloat(val));
  }
  return Math.round(parseFloat(val) * 1000);
}

export function parseMemoryToMb(val: string): number {
  if (!val) return 0;
  if (val.endsWith('Ki')) {
    return Math.round(parseFloat(val) / 1024);
  }
  if (val.endsWith('Mi')) {
    return Math.round(parseFloat(val));
  }
  if (val.endsWith('Gi')) {
    return Math.round(parseFloat(val) * 1024);
  }
  return Math.round(parseFloat(val) / (1024 * 1024));
}

export async function getPodMetrics(): Promise<{ metrics: PodMetric[]; history: Record<string, SparklinePoint[]> }> {
  const metrics: PodMetric[] = [];
  const now = new Date().toLocaleTimeString();

  // Q8: argv form through the task executor (validator + task log)
  // instead of a raw shell string. A failed `kubectl top` (no cluster,
  // no metrics-server) still reads as empty metrics, as before — the
  // old `2>/dev/null` only ever hid the same failure.
  // persist: false — the cluster page polls this every 8s, and TaskStore
  // has no row pruning; a persisted row per poll would grow SQLite
  // without bound (~900 rows/hour per open tab). Same rationale as the
  // watcher poll loop in waffle/watcher.ts.
  const podsTop = await processManager.runCommandAndWait('kubectl', ['top', 'pods', '-A', '--no-headers'], {
    cwd: process.cwd(),
    persist: false,
  });
  if (podsTop.code === 0) {
    const stdout = podsTop.stdout;
    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const [namespace, name, cpuStr, memStr] = parts;
        const cpuMillicores = parseCpuToMillicores(cpuStr);
        const memoryMb = parseMemoryToMb(memStr);

        const m: PodMetric = {
          namespace,
          name,
          cpuMillicores,
          memoryMb,
          timestamp: now,
        };
        metrics.push(m);

        // Update sparkline history
        const key = `${namespace}/${name}`;
        const points = podMetricHistory.get(key) || [];
        points.push({ time: now, cpu: cpuMillicores, memory: memoryMb });
        if (points.length > MAX_HISTORY_POINTS) {
          points.shift();
        }
        podMetricHistory.set(key, points);
      }
    }
  }
  // A non-zero exit (no cluster, no metrics-server) leaves metrics
  // empty, as the old `2>/dev/null` catch-all did.

  const historyObj: Record<string, SparklinePoint[]> = {};
  for (const [k, v] of podMetricHistory.entries()) {
    historyObj[k] = v;
  }

  return { metrics, history: historyObj };
}

export async function getNodeMetrics(): Promise<NodeMetric[]> {
  const metrics: NodeMetric[] = [];

  // Q8: argv form through the task executor (validator + task log)
  // instead of a raw shell string. A non-zero exit (no cluster, no
  // metrics-server) leaves metrics empty, as before.
  // persist: false — see getPodMetrics above; same 8s poll, same
  // unbounded-row hazard.
  const nodesTop = await processManager.runCommandAndWait('kubectl', ['top', 'nodes', '--no-headers'], {
    cwd: process.cwd(),
    persist: false,
  });
  if (nodesTop.code === 0) {
    const lines = nodesTop.stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const [name, cpuStr, cpuPctStr, memStr, memPctStr] = parts;
        metrics.push({
          name,
          cpuMillicores: parseCpuToMillicores(cpuStr),
          cpuPercent: parseFloat(cpuPctStr.replace('%', '')),
          memoryMb: parseMemoryToMb(memStr),
          memoryPercent: parseFloat(memPctStr.replace('%', '')),
        });
      }
    }
  }

  return metrics;
}
