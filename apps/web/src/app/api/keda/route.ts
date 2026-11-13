import { NextResponse } from 'next/server';
import {
  listScaledObjects,
  executeSyntheticLoad,
  kedaLoadSchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

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
    // C7: strict numerics + pattern enum (no Number() coercion).
    const config = kedaLoadSchema.parse(body);

    const result = await executeSyntheticLoad(config);
    // C4/C8: an unknown workload is a miss, not a run against store[0].
    if (!result) {
      return apiError(404, `ScaledObject for workload ${config.targetWorkload} not found`);
    }

    return NextResponse.json({ success: true, result });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/keda',
      fallbackMessage: 'Failed to execute synthetic load',
    });
  }
}
