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
  const denied = await authorizeRequest(req, 'argo:sync');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { action, snapshotId } = body;

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
