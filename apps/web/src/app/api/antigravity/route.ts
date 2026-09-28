import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  askAntigravity,
  getAntigravityEngineStatus,
  buildClusterContext,
} from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const root = getProjectRoot();
    const status = getAntigravityEngineStatus();
    const { snapshot } = await buildClusterContext(root);

    const samplePrompts = [
      'What is the current health status of the cluster nodes and pods?',
      'Are there any failing pods, crash loops, or degraded workloads?',
      'List all deployed ArgoCD applications and their sync status.',
      'How do I add or scale worker nodes in this cluster?',
      'Show me all active ingress hosts and TLS certificate statuses.',
      'Suggest optimizations or cleanup actions for my Kubernetes resources.',
    ];

    return NextResponse.json({
      engine: status,
      clusterSnapshot: snapshot,
      samplePrompts,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json().catch(() => ({}));
    const {
      prompt,
      conversationId,
      model,
      effort = 'low',
      includeClusterContext = true,
    } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        { error: 'A non-empty prompt string is required.' },
        { status: 400 }
      );
    }

    if (prompt.length > 5000) {
      return NextResponse.json(
        { error: 'Prompt exceeds maximum length of 5000 characters.' },
        { status: 400 }
      );
    }

    const result = await askAntigravity({
      prompt: prompt.trim(),
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
      model: typeof model === 'string' ? model : undefined,
      effort: ['low', 'medium', 'high'].includes(effort) ? effort : 'low',
      includeClusterContext: Boolean(includeClusterContext),
      root,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Antigravity execution failed.' },
      { status: 500 }
    );
  }
}
