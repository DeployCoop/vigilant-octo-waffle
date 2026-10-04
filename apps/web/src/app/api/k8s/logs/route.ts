import { NextResponse } from 'next/server';
import { K8sClient } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const namespace = searchParams.get('namespace');
    const name = searchParams.get('pod');

    // Logs get their own permission: they routinely leak secrets.
    const denied = await authorizeRequest(req, 'k8s:logs:read', {
      namespace: namespace ?? undefined,
    });
    if (denied) return denied;
    const container = searchParams.get('container') || undefined;
    const tailLinesParam = searchParams.get('tailLines');
    const tailLines = tailLinesParam ? parseInt(tailLinesParam, 10) : 250;

    if (!namespace || !name) {
      return apiError(400, 'namespace and pod name required');
    }

    const k8sClient = new K8sClient();
    const logs = await k8sClient.getPodLogs({
      namespace,
      name,
      container,
      tailLines,
    });

    return NextResponse.json({ logs });
  } catch (err: any) {
    return routeError(err, { route: 'GET /api/k8s/logs' });
  }
}
