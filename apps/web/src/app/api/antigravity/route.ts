import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  askAntigravity,
  getAntigravityEngineStatus,
  buildClusterContext,
  type AIProvider,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'tasks:read');
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const ollamaEndpoint = searchParams.get('ollamaEndpoint') || undefined;
    const vllmEndpoint = searchParams.get('vllmEndpoint') || undefined;

    const root = getProjectRoot();
    const status = await getAntigravityEngineStatus({
      ollama: ollamaEndpoint,
      vllm: vllmEndpoint,
    });
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
  // Asking the agent runs cluster-aware AI actions on the caller's behalf.
  const denied = await authorizeRequest(req, 'tasks:run');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const body = await req.json().catch(() => ({}));
    const {
      prompt,
      provider = 'antigravity',
      model,
      customEndpoint,
      conversationId,
      effort = 'low',
      includeClusterContext = true,
    } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        { error: 'A non-empty prompt string is required.' },
        { status: 400 }
      );
    }

    if (prompt.length > 8000) {
      return NextResponse.json(
        { error: 'Prompt exceeds maximum length of 8000 characters.' },
        { status: 400 }
      );
    }

    const validProviders: AIProvider[] = ['antigravity', 'ollama', 'vllm'];
    const activeProvider: AIProvider = validProviders.includes(provider) ? provider : 'antigravity';

    const result = await askAntigravity({
      prompt: prompt.trim(),
      provider: activeProvider,
      model: typeof model === 'string' && model.trim() ? model.trim() : undefined,
      customEndpoint: typeof customEndpoint === 'string' && customEndpoint.trim() ? customEndpoint.trim() : undefined,
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
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
      { error: err.message || 'AI Copilot execution failed.' },
      { status: 500 }
    );
  }
}
