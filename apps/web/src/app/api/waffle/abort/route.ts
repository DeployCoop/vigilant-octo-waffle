import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { getWaffleRunner } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const root = getProjectRoot();
    const runner = getWaffleRunner(root);
    runner.abort();
    return NextResponse.json({ success: true, message: 'Pipeline run abort signal sent' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to abort pipeline' }, { status: 500 });
  }
}
