import { NextResponse } from 'next/server';
import { fetchClusterTraces } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const service = searchParams.get('service') || undefined;
    const minDuration = parseInt(searchParams.get('minDuration') || '0') || 0;

    const traces = await fetchClusterTraces(service, minDuration);
    return NextResponse.json({ traces });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch distributed traces', traces: [] },
      { status: 500 }
    );
  }
}
