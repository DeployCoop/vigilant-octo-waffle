import { NextResponse } from 'next/server';
import {
  measureResilienceScore,
  injectPodKill,
  injectCpuStress,
  injectNetworkLatency,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // The resilience score is a security posture metric.
  const denied = await authorizeRequest(req, 'security:read');
  if (denied) return denied;

  try {
    const report = await measureResilienceScore();
    return NextResponse.json(report);
  } catch (err) {
    return routeError(err, { route: 'GET /api/chaos', fallbackMessage: 'Failed to measure resilience score' });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { type, namespace, podName, durationSec = 10, latencyMs = 200 } = body;

    // Critical permission: chaos injection, scoped to the target namespace.
    const denied = await authorizeRequest(req, 'chaos:run', { namespace });
    if (denied) return denied;

    if (!namespace || !podName) {
      return apiError(400, 'namespace and podName are required');
    }

    let experiment;
    if (type === 'pod_kill') {
      experiment = await injectPodKill(namespace, podName);
    } else if (type === 'cpu_stress') {
      experiment = await injectCpuStress(namespace, podName, durationSec);
    } else if (type === 'network_latency') {
      experiment = await injectNetworkLatency(namespace, podName, latencyMs, durationSec);
    } else {
      return apiError(400, `Unknown experiment type: ${type}`);
    }

    return NextResponse.json({ success: true, experiment });
  } catch (err) {
    return routeError(err, { route: 'POST /api/chaos', status: 400, fallbackMessage: 'Chaos injection failed' });
  }
}
