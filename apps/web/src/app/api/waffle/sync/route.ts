import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { getWaffleSourceManager } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'tasks:run');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const sourceManager = getWaffleSourceManager(root);
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return apiError(400, 'Source ID is required in body');
    }

    const updated = await sourceManager.syncSource(id);
    return NextResponse.json({ source: updated, message: `Source "${id}" synchronized` });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/waffle/sync',
      fallbackMessage: 'Sync failed',
    });
  }
}
