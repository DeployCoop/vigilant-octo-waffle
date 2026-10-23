import { NextResponse } from 'next/server';
import { K8sClient } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'apps:read');
  if (denied) return denied;

  try {
    const k8sClient = new K8sClient();
    const result = await k8sClient.getArgoApplications();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { installed: false, applications: [], error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
