import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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

  try {
    const { stdout } = await execAsync('kubectl top pods -A --no-headers 2>/dev/null');
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
  } catch {
    // metrics-server not yet ready, return fallback empty metrics
  }

  const historyObj: Record<string, SparklinePoint[]> = {};
  for (const [k, v] of podMetricHistory.entries()) {
    historyObj[k] = v;
  }

  return { metrics, history: historyObj };
}

export async function getNodeMetrics(): Promise<NodeMetric[]> {
  const metrics: NodeMetric[] = [];

  try {
    const { stdout } = await execAsync('kubectl top nodes --no-headers 2>/dev/null');
    const lines = stdout.trim().split('\n').filter(Boolean);

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
  } catch {
    // metrics-server not yet ready
  }

  return metrics;
}
