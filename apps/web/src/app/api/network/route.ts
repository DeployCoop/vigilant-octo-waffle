import { NextResponse } from 'next/server';
import { scanNetworkPolicies, scaffoldZeroTrustPolicy } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'network:manage');
  if (denied) return denied;

  try {
    const report = await scanNetworkPolicies();
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to scan network policies' },
      { status: 500 }
    );
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
        return NextResponse.json(
          { error: 'appId is required to scaffold network policy' },
          { status: 400 }
        );
      }
      const manifest = scaffoldZeroTrustPolicy(appId, namespace, allowedCallers);
      return NextResponse.json({ success: true, manifest });
    }

    return NextResponse.json(
      { error: `Unknown network action: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Network action failed' },
      { status: 500 }
    );
  }
}
