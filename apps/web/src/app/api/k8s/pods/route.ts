import { NextResponse } from 'next/server';
import { K8sClient } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const namespace = searchParams.get('namespace') || undefined;

    const denied = await authorizeRequest(req, 'k8s:read', { namespace });
    if (denied) return denied;

    const k8sClient = new K8sClient();
    const pods = await k8sClient.getPods(namespace);
    return NextResponse.json({ pods });
  } catch (err: any) {
    return NextResponse.json({ pods: [], error: err.message }, { status: 500 });
  }
}
