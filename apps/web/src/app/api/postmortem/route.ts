import { NextResponse } from 'next/server';
import {
  listHistoricalPostmortems,
  generatePostmortem,
  postmortemGenerateSchema,
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
    // C7: severity enum + affectedWorkloads array (a non-array used to 500
    // on .join()); defaults mirror the old destructuring defaults.
    const params = postmortemGenerateSchema.parse(body);

    const report = await generatePostmortem(params);

    return NextResponse.json({ success: true, report });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/postmortem',
      fallbackMessage: 'Failed to generate incident postmortem',
    });
  }
}
