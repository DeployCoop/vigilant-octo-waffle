import { NextResponse } from 'next/server';
import { executePostgresQuery } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { query, database, namespace } = body;

    // Critical permission: arbitrary SQL against cluster databases.
    const denied = await authorizeRequest(req, 'data:query', { namespace });
    if (denied) return denied;

    if (!query || typeof query !== 'string') {
      return apiError(400, 'query string is required');
    }

    const result = await executePostgresQuery(query, { database, namespace });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return routeError(err, { route: 'POST /api/data/sql', status: 400, fallbackMessage: 'Database query execution failed' });
  }
}
