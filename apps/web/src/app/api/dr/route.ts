import { NextResponse } from 'next/server';
import {
  getDRScorecard,
  executeDisasterRecoveryDrill,
  drDrillSchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const scorecard = await getDRScorecard();
    return NextResponse.json(scorecard);
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/dr',
      fallbackMessage: 'Failed to fetch disaster recovery scorecard',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:manage');
  if (denied) return denied;

  try {
    const body = await req.json();
    // C7: unknown scenarios are rejected by schema (was a manual allow-list).
    const { scenario } = drDrillSchema.parse(body);

    const drillResult = await executeDisasterRecoveryDrill(scenario);
    return NextResponse.json({ success: true, drillResult });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/dr',
      fallbackMessage: 'Failed to execute disaster recovery drill',
    });
  }
}
