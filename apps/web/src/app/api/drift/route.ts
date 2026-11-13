import { NextResponse } from 'next/server';
import {
  scanClusterDrift,
  reconcileClusterFromGit,
  generateReverseCommitPatch,
  resetDriftStore,
  driftRemediateSchema,
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
  try {
    const body = await req.json();
    const { action } = body;

    // BUG FIX (bug hunt B6): resetting wipes the remediation record
    // (resolvedDriftIds.clear()), resurrecting every drift item and
    // erasing which drifts were reconciled — audit-state destruction,
    // not a sync. It is gated on cluster:manage and, unlike before,
    // the gate runs even though reset needs no driftId (the old code
    // ran the reset branch before the driftId check, under argo:sync).
    // Reconcile/reverse_commit stay on argo:sync; unknown actions keep
    // the previous gate, then 400.
    if (action === 'reset') {
      const denied = await authorizeRequest(req, 'cluster:manage');
      if (denied) return denied;
      resetDriftStore();
      const fresh = await scanClusterDrift();
      return NextResponse.json({ success: true, message: 'Reset drift store', report: fresh });
    }

    const denied = await authorizeRequest(req, 'argo:sync');
    if (denied) return denied;

    // C7: driftId validated inside the branches, after the argo:sync gate,
    // preserving the B6 gate ordering.
    if (action === 'reconcile') {
      const { driftId } = driftRemediateSchema.parse(body);
      const result = await reconcileClusterFromGit(driftId);
      return NextResponse.json(result);
    } else if (action === 'reverse_commit') {
      const { driftId } = driftRemediateSchema.parse(body);
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
