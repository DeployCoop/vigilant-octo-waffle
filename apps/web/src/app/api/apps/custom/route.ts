import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  listCustomApps,
  scaffoldCustomApp,
  deleteCustomApp,
  type CustomAppOptions,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'apps:read');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const apps = listCustomApps(root);
    return NextResponse.json({ apps });
  } catch (err) {
    return routeError(err, { route: 'GET /api/apps/custom' });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const options: CustomAppOptions = await req.json();

    const denied = await authorizeRequest(req, 'apps:deploy', { appId: options.id });
    if (denied) return denied;

    if (!options.id || !options.name || !options.repoURL) {
      return apiError(400, 'id, name, and repoURL are required');
    }

    const result = scaffoldCustomApp(options, root);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, { route: 'POST /api/apps/custom' });
  }
}

export async function DELETE(req: Request) {
  try {
    const root = getProjectRoot();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError(400, 'id query param required');
    }

    const denied = await authorizeRequest(req, 'apps:deploy', { appId: id });
    if (denied) return denied;

    deleteCustomApp(id, root);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    return routeError(err, { route: 'DELETE /api/apps/custom' });
  }
}
