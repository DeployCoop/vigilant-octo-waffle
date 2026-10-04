import { NextResponse } from 'next/server';
import { listS3Buckets } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'data:query');
  if (denied) return denied;

  try {
    const result = await listS3Buckets();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to query S3 storage', buckets: [] },
      { status: 500 }
    );
  }
}
