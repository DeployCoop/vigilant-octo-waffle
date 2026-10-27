import { NextResponse } from 'next/server';
import {
  captureLiveFlows,
  getDnsTelemetry,
  simulatePacketDropInspection,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const namespace = searchParams.get('namespace') || undefined;

    const [flows, dns] = await Promise.all([
      captureLiveFlows(namespace),
      getDnsTelemetry(),
    ]);

    return NextResponse.json({
      flows,
      dns,
      capturedAt: new Date().toISOString(),
    });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/ebpf',
      fallbackMessage: 'Failed to capture eBPF telemetry',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { sourcePod, targetPod, port = 80 } = body;

    if (!sourcePod || !targetPod) {
      return apiError(400, 'sourcePod and targetPod are required');
    }

    const result = await simulatePacketDropInspection(sourcePod, targetPod, Number(port));
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/ebpf',
      fallbackMessage: 'Packet flow inspection failed',
    });
  }
}
