import { NextResponse } from 'next/server';
import {
  captureLiveFlows,
  getDnsTelemetry,
  simulatePacketDropInspection,
  ebpfInspectSchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

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
    // C7: strict numerics — port must be a real int 1-65535 (no Number() coercion).
    const { sourcePod, targetPod, port } = ebpfInspectSchema.parse(body);

    const result = await simulatePacketDropInspection(sourcePod, targetPod, port);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/ebpf',
      fallbackMessage: 'Packet flow inspection failed',
    });
  }
}
