import { NextResponse } from 'next/server';
import { estimateFinOpsTelemetry, getK3sFinOpsStatus } from '@vow/orchestrator';
import { getProjectRoot } from '@/lib/project';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

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
  } catch (err) {
    return routeError(err, { route: 'GET /api/finops', fallbackMessage: 'Failed to estimate FinOps telemetry' });
  }
}
