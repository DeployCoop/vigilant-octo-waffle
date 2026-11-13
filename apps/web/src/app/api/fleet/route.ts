import { NextResponse } from 'next/server';
import {
  listFleetClusters,
  switchClusterContext,
  broadcastApplication,
  fleetActionSchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const clusters = await listFleetClusters();
    return NextResponse.json({ clusters });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/fleet',
      fallbackMessage: 'Failed to list fleet clusters',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:manage');
  if (denied) return denied;

  try {
    const body = await req.json();
    // C7: discriminated action schema (unknown actions and empty target
    // arrays are rejected); C8: unknown ids 404.
    const parsed = fleetActionSchema.parse(body);

    if (parsed.action === 'switch_context') {
      const result = await switchClusterContext(parsed.clusterId);
      if (!result.success) return apiError(404, result.message);
      return NextResponse.json(result);
    }
    const result = await broadcastApplication(parsed.appId, parsed.targetClusterIds);
    if (!result.success) return apiError(404, result.message);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/fleet',
      fallbackMessage: 'Fleet operation failed',
    });
  }
}
