import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { checkConfig, reconcileConfig } from '@vow/orchestrator';

export async function GET() {
  try {
    const root = getProjectRoot();
    const report = checkConfig(root);
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json().catch(() => ({}));
    const applyFixes = body.applyFixes !== false;
    const report = reconcileConfig(root, { applyFixes });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
