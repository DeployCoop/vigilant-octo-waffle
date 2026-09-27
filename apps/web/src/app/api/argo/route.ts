import { NextResponse } from 'next/server';
import { K8sClient } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const k8sClient = new K8sClient();
    const result = await k8sClient.getArgoApplications();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ installed: false, applications: [], error: err.message }, { status: 500 });
  }
}
