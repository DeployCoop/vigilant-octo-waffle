import { NextResponse } from 'next/server';
import {
  listHistoricalPostmortems,
  generatePostmortem,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const postmortems = await listHistoricalPostmortems();
    return NextResponse.json({ postmortems });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/postmortem',
      fallbackMessage: 'Failed to list historical postmortems',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'ai:diagnose');
  if (denied) return denied;

  try {
    const body = await req.json();
    const {
      incidentTitle = 'Cascading Timeout on Authentication Subsystem',
      affectedWorkloads = ['keycloak-0', 'postgres-postgresql-0'],
      severity = 'SEV-2',
    } = body;

    const report = await generatePostmortem({
      incidentTitle,
      affectedWorkloads,
      severity,
    });

    return NextResponse.json({ success: true, report });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/postmortem',
      fallbackMessage: 'Failed to generate incident postmortem',
    });
  }
}
