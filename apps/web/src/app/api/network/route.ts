import { NextResponse } from 'next/server';
import { scanNetworkPolicies, scaffoldZeroTrustPolicy } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'network:manage');
  if (denied) return denied;

  try {
    const report = await scanNetworkPolicies();
    return NextResponse.json(report);
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/network',
      fallbackMessage: 'Failed to scan network policies',
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, appId, namespace = 'default', allowedCallers = [] } = body;

    const denied = await authorizeRequest(req, 'network:manage', { namespace, appId });
    if (denied) return denied;

    if (action === 'scaffold') {
      if (!appId) {
        return apiError(400, 'appId is required to scaffold network policy');
      }
      const manifest = scaffoldZeroTrustPolicy(appId, namespace, allowedCallers);
      return NextResponse.json({ success: true, manifest });
    }

    return apiError(400, `Unknown network action: ${action}`);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/network',
      fallbackMessage: 'Network action failed',
    });
  }
}
