import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { getWaffleSourceManager } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Waffle sources are project configuration.
  const denied = await authorizeRequest(req, 'config:update');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const sourceManager = getWaffleSourceManager(root);
    const body = await req.json();

    const { type, pathOrUrl, name, branch } = body;
    if (!type || !pathOrUrl) {
      return apiError(400, 'Fields "type" (local | git) and "pathOrUrl" are required');
    }

    if (type !== 'local' && type !== 'git') {
      return apiError(400, 'Type must be either "local" or "git"');
    }

    const source = await sourceManager.addSource({
      type,
      pathOrUrl,
      name,
      branch,
    });

    return NextResponse.json({ source, message: 'Waffle source added successfully' });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/waffle/sources',
      status: 400,
      fallbackMessage: 'Failed to add source',
    });
  }
}

export async function DELETE(req: Request) {
  const denied = await authorizeRequest(req, 'config:update');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const sourceManager = getWaffleSourceManager(root);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError(400, 'Parameter "id" is required');
    }

    const removed = await sourceManager.removeSource(id);
    if (!removed) {
      return apiError(404, `Source "${id}" not found`);
    }

    return NextResponse.json({ success: true, message: `Waffle source "${id}" removed` });
  } catch (err) {
    return routeError(err, {
      route: 'DELETE /api/waffle/sources',
      fallbackMessage: 'Failed to remove source',
    });
  }
}
