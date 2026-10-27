import { NextResponse } from 'next/server';
import {
  listFleetClusters,
  switchClusterContext,
  broadcastApplication,
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
    const { action, clusterId, appId, targetClusterIds } = body;

    if (action === 'switch_context') {
      if (!clusterId) {
        return apiError(400, 'clusterId is required');
      }
      const result = await switchClusterContext(clusterId);
      return NextResponse.json(result);
    } else if (action === 'broadcast') {
      if (!appId || !targetClusterIds || !Array.isArray(targetClusterIds)) {
        return apiError(400, 'appId and targetClusterIds array are required');
      }
      const result = await broadcastApplication(appId, targetClusterIds);
      return NextResponse.json(result);
    } else {
      return apiError(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/fleet',
      fallbackMessage: 'Fleet operation failed',
    });
  }
}
