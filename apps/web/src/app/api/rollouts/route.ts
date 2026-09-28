import { NextResponse } from 'next/server';
import {
  listRollouts,
  setCanaryWeight,
  promoteRollout,
  abortRollout,
} from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const namespace = searchParams.get('namespace') || undefined;
    const rollouts = await listRollouts(namespace);
    return NextResponse.json({ rollouts });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to list rollouts', rollouts: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, name, namespace, weight, full } = body;

    if (!name || !namespace) {
      return NextResponse.json(
        { error: 'name and namespace are required' },
        { status: 400 }
      );
    }

    if (action === 'set_weight') {
      const res = await setCanaryWeight(name, namespace, Number(weight) || 0);
      return NextResponse.json(res);
    }

    if (action === 'promote') {
      const res = await promoteRollout(name, namespace, !!full);
      return NextResponse.json(res);
    }

    if (action === 'abort') {
      const res = await abortRollout(name, namespace);
      return NextResponse.json(res);
    }

    return NextResponse.json(
      { error: `Unknown rollout action: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Rollout action failed' },
      { status: 500 }
    );
  }
}
