import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { getWaffleSourceManager } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

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
      return NextResponse.json({ error: 'Fields "type" (local | git) and "pathOrUrl" are required' }, { status: 400 });
    }

    if (type !== 'local' && type !== 'git') {
      return NextResponse.json({ error: 'Type must be either "local" or "git"' }, { status: 400 });
    }

    const source = await sourceManager.addSource({
      type,
      pathOrUrl,
      name,
      branch,
    });

    return NextResponse.json({ source, message: 'Waffle source added successfully' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to add source' }, { status: 400 });
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
      return NextResponse.json({ error: 'Parameter "id" is required' }, { status: 400 });
    }

    const removed = await sourceManager.removeSource(id);
    if (!removed) {
      return NextResponse.json({ error: `Source "${id}" not found` }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: `Waffle source "${id}" removed` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to remove source' }, { status: 500 });
  }
}
