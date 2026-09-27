import { NextResponse } from 'next/server';
import { getPodMetrics, getNodeMetrics } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'all';

    let podsData: any = { metrics: [], history: {} };
    let nodes: any[] = [];

    if (type === 'pod' || type === 'all') {
      podsData = await getPodMetrics();
    }

    if (type === 'node' || type === 'all') {
      nodes = await getNodeMetrics();
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      pods: podsData.metrics,
      history: podsData.history,
      nodes,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch metrics', pods: [], nodes: [], history: {} },
      { status: 500 }
    );
  }
}
