import { NextResponse } from 'next/server';
import {
  listHistoricalSnapshots,
  compareSnapshotWithLive,
  rewindToSnapshot,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const snapshots = await listHistoricalSnapshots();
    return NextResponse.json({ snapshots });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/rewind',
      fallbackMessage: 'Failed to list cluster snapshots',
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, snapshotId } = body;

    // BUG FIX (bug hunt B6): comparing a snapshot is a read, but
    // rewinding the cluster to one is a cluster-wide rollback, not a
    // sync — the old single argo:sync gate let any operator roll the
    // cluster back. Unknown actions keep the previous gate, then 400.
    const denied = await authorizeRequest(
      req,
      action === 'compare' ? 'cluster:read' : action === 'rewind' ? 'cluster:manage' : 'argo:sync'
    );
    if (denied) return denied;

    if (!snapshotId) {
      return apiError(400, 'snapshotId is required');
    }

    if (action === 'compare') {
      const result = await compareSnapshotWithLive(snapshotId);
      return NextResponse.json({ success: true, comparison: result });
    } else if (action === 'rewind') {
      const result = await rewindToSnapshot(snapshotId);
      return NextResponse.json(result);
    } else {
      return apiError(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/rewind',
      fallbackMessage: 'Cluster rewind operation failed',
    });
  }
}
