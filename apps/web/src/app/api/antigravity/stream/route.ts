import { getProjectRoot } from '@/lib/project';
import { streamAntigravity, type AIProvider } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Authorize before opening the stream.
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
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await streamAntigravity(
            {
              root,
              prompt: prompt.trim(),
              provider: (provider as AIProvider) || 'antigravity',
              model: typeof model === 'string' ? model : undefined,
              customEndpoint: typeof customEndpoint === 'string' ? customEndpoint : undefined,
              conversationId: typeof conversationId === 'string' ? conversationId : undefined,
              effort: ['low', 'medium', 'high'].includes(effort) ? effort : 'low',
              includeClusterContext: Boolean(includeClusterContext),
            },
            (event) => {
              const payload = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(payload));
            }
          );
        } catch (err: any) {
          const errorPayload = `data: ${JSON.stringify({ type: 'error', error: err.message || 'Stream error' })}\n\n`;
          controller.enqueue(encoder.encode(errorPayload));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
