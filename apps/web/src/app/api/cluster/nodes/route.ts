import { NextResponse } from 'next/server';
import { listClusterNodeDetails, scaleK3dNodes } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const nodes = await listClusterNodeDetails();
    return NextResponse.json({ nodes });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to list cluster nodes', nodes: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, clusterName = 'vigilant-octo-waffle', targetAgentCount, delta = 1 } = body;

    if (action === 'scale_k3d') {
      const currentNodes = await listClusterNodeDetails();
      const currentWorkers = currentNodes.filter((n) => n.role === 'worker').length;
      const target = typeof targetAgentCount === 'number' ? targetAgentCount : Math.max(1, currentWorkers + delta);
      const result = await scaleK3dNodes(clusterName, target);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Node scaling operation failed' },
      { status: 500 }
    );
  }
}
