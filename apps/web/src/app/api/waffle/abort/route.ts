import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { getWaffleRunner } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'tasks:run');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const runner = getWaffleRunner(root);
    runner.abort();
    return NextResponse.json({ success: true, message: 'Pipeline run abort signal sent' });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/waffle/abort',
      fallbackMessage: 'Failed to abort pipeline',
    });
  }
}
