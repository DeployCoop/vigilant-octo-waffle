import { NextResponse } from 'next/server';
import { K8sClient } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const k8sClient = new K8sClient();
    const data = k8sClient.getContexts();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ current: '', contexts: [], error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { contextName } = body;

    if (!contextName) {
      return NextResponse.json({ error: 'contextName required' }, { status: 400 });
    }

    const k8sClient = new K8sClient();
    await k8sClient.switchContext(contextName);

    return NextResponse.json({ success: true, current: contextName });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
