import { NextResponse } from 'next/server';
import { listS3Buckets } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'data:query');
  if (denied) return denied;

  try {
    const result = await listS3Buckets();
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, { route: 'GET /api/data/s3', fallbackMessage: 'Failed to query S3 storage' });
  }
}
