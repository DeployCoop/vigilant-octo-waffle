import { NextResponse } from 'next/server';
import { listS3Buckets } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
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
