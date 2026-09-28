import { NextResponse } from 'next/server';
import { K8sClient } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const namespace = searchParams.get('namespace') || undefined;

    const k8sClient = new K8sClient();
    const pods = await k8sClient.getPods(namespace);
    return NextResponse.json({ pods });
  } catch (err: any) {
    return NextResponse.json({ pods: [], error: err.message }, { status: 500 });
  }
}
