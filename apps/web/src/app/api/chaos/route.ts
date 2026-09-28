import { NextResponse } from 'next/server';
import {
  measureResilienceScore,
  injectPodKill,
  injectCpuStress,
  injectNetworkLatency,
} from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = await measureResilienceScore();
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to measure resilience score' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, namespace, podName, durationSec = 10, latencyMs = 200 } = body;

    if (!namespace || !podName) {
      return NextResponse.json(
        { error: 'namespace and podName are required' },
        { status: 400 }
      );
    }

    let experiment;
    if (type === 'pod_kill') {
      experiment = await injectPodKill(namespace, podName);
    } else if (type === 'cpu_stress') {
      experiment = await injectCpuStress(namespace, podName, durationSec);
    } else if (type === 'network_latency') {
      experiment = await injectNetworkLatency(namespace, podName, latencyMs, durationSec);
    } else {
      return NextResponse.json(
        { error: `Unknown experiment type: ${type}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, experiment });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Chaos injection failed' },
      { status: 400 }
    );
  }
}
