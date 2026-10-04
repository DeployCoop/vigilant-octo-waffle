import { NextResponse } from 'next/server';
import { fetchClusterTraces } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const service = searchParams.get('service') || undefined;
    const minDuration = parseInt(searchParams.get('minDuration') || '0') || 0;

    const traces = await fetchClusterTraces(service, minDuration);
    return NextResponse.json({ traces });
  } catch (err) {
    return routeError(err, { route: 'GET /api/traces', fallbackMessage: 'Failed to fetch distributed traces' });
  }
}
