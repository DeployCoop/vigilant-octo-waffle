import { NextResponse } from 'next/server';
import { estimateFinOpsTelemetry } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const batterySaver = searchParams.get('batterySaver') === 'true';
    const report = await estimateFinOpsTelemetry(batterySaver);
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to estimate FinOps telemetry' },
      { status: 500 }
    );
  }
}
