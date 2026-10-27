import { NextResponse } from 'next/server';
import {
  scanClusterDrift,
  reconcileClusterFromGit,
  generateReverseCommitPatch,
  resetDriftStore,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const report = await scanClusterDrift();
    return NextResponse.json(report);
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/drift',
      fallbackMessage: 'Failed to scan cluster drift',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'argo:sync');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { action, driftId } = body;

    if (action === 'reset') {
      resetDriftStore();
      const fresh = await scanClusterDrift();
      return NextResponse.json({ success: true, message: 'Reset drift store', report: fresh });
    }

    if (!driftId) {
      return apiError(400, 'driftId is required');
    }

    if (action === 'reconcile') {
      const result = await reconcileClusterFromGit(driftId);
      return NextResponse.json(result);
    } else if (action === 'reverse_commit') {
      const result = await generateReverseCommitPatch(driftId);
      return NextResponse.json(result);
    } else {
      return apiError(400, `Unknown action: ${action}. Expected reconcile or reverse_commit`);
    }
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/drift',
      fallbackMessage: 'Drift remediation action failed',
    });
  }
}
