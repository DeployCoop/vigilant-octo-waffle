import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { getWaffleSourceManager } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

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
      return NextResponse.json({ error: 'Source ID is required in body' }, { status: 400 });
    }

    const updated = await sourceManager.syncSource(id);
    return NextResponse.json({ source: updated, message: `Source "${id}" synchronized` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Sync failed' }, { status: 500 });
  }
}
