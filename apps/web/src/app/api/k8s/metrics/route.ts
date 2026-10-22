import { NextResponse } from 'next/server';
import {
  getPodMetrics,
  getNodeMetrics,
  type NodeMetric,
  type PodMetric,
  type SparklinePoint,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'k8s:read');
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'all';

    let podsData: { metrics: PodMetric[]; history: Record<string, SparklinePoint[]> } = {
      metrics: [],
      history: {},
    };
    let nodes: NodeMetric[] = [];

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
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/k8s/metrics',
      fallbackMessage: 'Failed to fetch metrics',
    });
  }
}
