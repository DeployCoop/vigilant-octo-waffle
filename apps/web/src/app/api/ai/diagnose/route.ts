import { NextResponse } from 'next/server';
import { diagnoseIncident } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { podName, namespace, containerName } = body;

    const denied = await authorizeRequest(req, 'ai:diagnose', { namespace });
    if (denied) return denied;

    if (!podName || !namespace) {
      return NextResponse.json(
        { error: 'podName and namespace are required' },
        { status: 400 }
      );
    }

    const diagnosis = await diagnoseIncident(namespace, podName, containerName);
    return NextResponse.json({
      ...diagnosis,
      summary: diagnosis.explanation,
      provider: diagnosis.engineUsed === 'ollama' ? 'In-Cluster Ollama LLM' : 'Rule-Based Heuristic Engine',
      confidence: diagnosis.engineUsed === 'ollama' ? 0.92 : 0.85,
      recommendations: [diagnosis.suggestedFix],
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Diagnostic analysis failed' },
      { status: 500 }
    );
  }
}
