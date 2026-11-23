import { NextResponse } from 'next/server';
import {
  listFleetClusters,
  switchClusterContext,
  broadcastApplication,
  fleetActionSchema,
  ClusterUnavailableError,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

/** No-cluster contract (Phase 0 F1): the studio throws when there is no kubeconfig at all. */
function noCluster(err: unknown): NextResponse | null {
  if (err instanceof ClusterUnavailableError) {
    return apiError(503, 'No Kubernetes cluster is available', {
      code: 'cluster_unavailable',
    });
  }
  return null;
}

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const clusters = await listFleetClusters();
    return NextResponse.json({ clusters });
  } catch (err) {
    return (
      noCluster(err) ??
      routeError(err, {
        route: 'GET /api/fleet',
        fallbackMessage: 'Failed to list fleet clusters',
      })
    );
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
    const result = await broadcastApplication(parsed.appId, parsed.targetClusterIds, {
      projectRoot: getProjectRoot(),
    });
    // 404 only when nothing matched: a partial sync failure is a 200
    // carrying the per-cluster outcomes, not a not-found.
    if (result.results.length === 0) return apiError(404, result.message);
    return NextResponse.json(result);
  } catch (err) {
    return (
      noCluster(err) ??
      routeError(err, {
        route: 'POST /api/fleet',
        fallbackMessage: 'Fleet operation failed',
      })
    );
  }
}
