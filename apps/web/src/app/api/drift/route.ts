import { NextResponse } from 'next/server';
import {
  scanClusterDrift,
  reconcileClusterFromGit,
  generateReverseCommitPatch,
  driftRemediateSchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const report = await scanClusterDrift({ projectRoot: getProjectRoot() });
    return NextResponse.json(report);
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/drift',
      fallbackMessage: 'Failed to scan cluster drift',
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    // The `reset` action is gone with the in-memory drift store (Phase 1
    // wiring): the scan is stateless, so there is no remediation record
    // to wipe. Unknown actions keep the argo:sync gate, then 400.
    const denied = await authorizeRequest(req, 'argo:sync');
    if (denied) return denied;

    const projectRoot = getProjectRoot();

    // C7: driftId validated inside the branches, after the argo:sync gate,
    // preserving the B6 gate ordering. C8: unknown drift ids 404.
    if (action === 'reconcile') {
      const { driftId } = driftRemediateSchema.parse(body);
      const result = await reconcileClusterFromGit(driftId, { projectRoot });
      if (!result.success) return apiError(404, result.message);
      return NextResponse.json(result);
    } else if (action === 'reverse_commit') {
      const { driftId } = driftRemediateSchema.parse(body);
      const result = await generateReverseCommitPatch(driftId, { projectRoot });
      if (!result.success) return apiError(404, result.message ?? 'Drift not found.');
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
