import { NextResponse } from 'next/server';
import { apiError, routeError } from '@/lib/route-error';
import { K8sClient } from '@vow/orchestrator';
import { authorizeRequest, withAuthz } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;

  try {
    const k8sClient = new K8sClient();
    const data = k8sClient.getContexts();
    return NextResponse.json(data);
  } catch (err: any) {
    return routeError(err, { route: 'GET /api/cluster/contexts' });
  }
}

// Critical permission: switching the active cluster context.
export const POST = withAuthz('cluster:manage', async (req: Request) => {
  try {
    const body = await req.json();
    const { contextName } = body;

    if (!contextName) {
      return apiError(400, 'contextName required');
    }

    const k8sClient = new K8sClient();
    await k8sClient.switchContext(contextName);

    return NextResponse.json({ success: true, current: contextName });
  } catch (err) {
    return routeError(err, { route: 'POST /api/cluster/contexts' });
  }
});
