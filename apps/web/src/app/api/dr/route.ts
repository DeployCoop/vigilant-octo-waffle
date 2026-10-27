import { NextResponse } from 'next/server';
import {
  getDRScorecard,
  executeDisasterRecoveryDrill,
  type DRScenarioType,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

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
    const { scenario = 'POSTGRES_VOLUME_CORRUPTION' } = body;

    const validScenarios: DRScenarioType[] = [
      'POSTGRES_VOLUME_CORRUPTION',
      'NAMESPACE_ACCIDENTAL_DELETION',
      'ETCD_SPLIT_BRAIN_EMULATION',
    ];

    if (!validScenarios.includes(scenario)) {
      return apiError(
        400,
        `Invalid scenario: ${scenario}. Choose from ${validScenarios.join(', ')}`
      );
    }

    const drillResult = await executeDisasterRecoveryDrill(scenario);
    return NextResponse.json({ success: true, drillResult });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/dr',
      fallbackMessage: 'Failed to execute disaster recovery drill',
    });
  }
}
