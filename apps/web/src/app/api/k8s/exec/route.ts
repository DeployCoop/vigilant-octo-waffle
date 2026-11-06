import { NextResponse } from 'next/server';
import { execSessionManager } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) ?? {};
    const { action, sessionId, namespace, podName, containerName, command, data } = body;

    // Critical permission: pod exec. Authorized before any session is
    // touched; the 'start' action is checked against its namespace scope.
    const denied = await authorizeRequest(
      req,
      'k8s:exec',
      action === 'start' ? { namespace } : undefined
    );
    if (denied) return denied;

    if (action === 'start') {
      if (!namespace || !podName) {
        return apiError(400, 'namespace and podName are required');
      }

      const session = execSessionManager.createSession({
        namespace,
        podName,
        containerName,
        command: command ? [command] : undefined,
      });

      return NextResponse.json({ sessionId: session.id });
    }

    if (action === 'input') {
      if (!sessionId || typeof data !== 'string') {
        return apiError(400, 'sessionId and data required');
      }

      const session = execSessionManager.getSession(sessionId);
      if (!session) {
        return apiError(404, 'Session expired or not found');
      }

      session.write(data);
      return NextResponse.json({ success: true });
    }

    if (action === 'close') {
      if (sessionId) {
        execSessionManager.closeSession(sessionId);
      }
      return NextResponse.json({ success: true });
    }

    return apiError(400, 'Unknown action');
  } catch (err) {
    return routeError(err, { route: 'POST /api/k8s/exec' });
  }
}

export async function GET(req: Request) {
  // The exec output stream requires the same permission as starting it.
  const denied = await authorizeRequest(req, 'k8s:exec');
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return apiError(400, 'sessionId required', { route: 'GET /api/k8s/exec' });
  }

  const session = execSessionManager.getSession(sessionId);
  if (!session) {
    return apiError(404, 'Session not found', { route: 'GET /api/k8s/exec' });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connect notification
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      const cleanup = () => {
        session.off('data', onData);
        session.off('close', onClose);
      };

      const onData = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'output', data })}\n\n`));
        } catch {
          cleanup();
        }
      };

      const onClose = (code: number) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'close', code })}\n\n`));
          controller.close();
        } catch {
          // ignore
        } finally {
          cleanup();
        }
      };

      session.on('data', onData);
      session.on('close', onClose);

      req.signal.addEventListener('abort', () => {
        cleanup();
        execSessionManager.closeSession(sessionId);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
