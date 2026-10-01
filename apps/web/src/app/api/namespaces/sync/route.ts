import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { applyClusterNamespaces } from '@vow/orchestrator';

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const result = await applyClusterNamespaces(root, { dryRun });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
