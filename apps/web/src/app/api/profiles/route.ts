import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { ProfileManager } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const root = getProjectRoot();
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name') || 'vow-profile';

    const pm = new ProfileManager(root);
    const bundle = pm.exportProfile(name);

    return NextResponse.json(bundle);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const bundle = await req.json();

    const pm = new ProfileManager(root);
    pm.importProfile(bundle);

    return NextResponse.json({ success: true, name: bundle.name });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
