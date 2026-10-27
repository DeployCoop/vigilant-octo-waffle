import { NextResponse } from 'next/server';
import {
  listScaledObjects,
  executeSyntheticLoad,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const scaledObjects = await listScaledObjects();
    return NextResponse.json({ scaledObjects });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/keda',
      fallbackMessage: 'Failed to list KEDA ScaledObjects',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:manage');
  if (denied) return denied;

  try {
    const body = await req.json();
    const {
      targetWorkload,
      virtualUsers = 20,
      durationSeconds = 15,
      targetRps = 250,
      pattern = 'SPIKE',
    } = body;

    const result = await executeSyntheticLoad({
      targetWorkload: targetWorkload || 'nextcloud-worker',
      virtualUsers: Number(virtualUsers),
      durationSeconds: Number(durationSeconds),
      targetRps: Number(targetRps),
      pattern,
    });

    return NextResponse.json({ success: true, result });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/keda',
      fallbackMessage: 'Failed to execute synthetic load',
    });
  }
}
