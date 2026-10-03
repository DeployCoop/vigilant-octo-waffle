import { NextResponse } from 'next/server';
import { estimateFinOpsTelemetry, getK3sFinOpsStatus } from '@vow/orchestrator';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const root = getProjectRoot();
    const { searchParams } = new URL(req.url);
    const batterySaver = searchParams.get('batterySaver') === 'true';
    const [report, k3sFinOps] = await Promise.all([
      estimateFinOpsTelemetry(batterySaver),
      getK3sFinOpsStatus(root),
    ]);
    return NextResponse.json({
      ...report,
      k3sFinOps,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to estimate FinOps telemetry' },
      { status: 500 }
    );
  }
}
