import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  listCustomApps,
  scaffoldCustomApp,
  deleteCustomApp,
  type CustomAppOptions,
} from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const root = getProjectRoot();
    const apps = listCustomApps(root);
    return NextResponse.json({ apps });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, apps: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const options: CustomAppOptions = await req.json();

    if (!options.id || !options.name || !options.repoURL) {
      return NextResponse.json(
        { error: 'id, name, and repoURL are required' },
        { status: 400 }
      );
    }

    const result = scaffoldCustomApp(options, root);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const root = getProjectRoot();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    }

    deleteCustomApp(id, root);
    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
