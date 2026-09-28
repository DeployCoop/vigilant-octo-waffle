import { NextResponse } from 'next/server';
import { K8sClient } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const namespace = searchParams.get('namespace');
    const name = searchParams.get('pod');
    const container = searchParams.get('container') || undefined;
    const tailLinesParam = searchParams.get('tailLines');
    const tailLines = tailLinesParam ? parseInt(tailLinesParam, 10) : 250;

    if (!namespace || !name) {
      return NextResponse.json({ error: 'namespace and pod name required' }, { status: 400 });
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
    return NextResponse.json({ error: err.message, logs: '' }, { status: 500 });
  }
}
