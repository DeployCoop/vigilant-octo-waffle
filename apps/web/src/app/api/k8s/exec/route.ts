import { NextResponse } from 'next/server';
import { execSessionManager } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
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
        return NextResponse.json({ error: 'namespace and podName are required' }, { status: 400 });
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
        return NextResponse.json({ error: 'sessionId and data required' }, { status: 400 });
      }

      const session = execSessionManager.getSession(sessionId);
      if (!session) {
        return NextResponse.json({ error: 'Session expired or not found' }, { status: 404 });
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

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // The exec output stream requires the same permission as starting it.
  const denied = await authorizeRequest(req, 'k8s:exec');
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return new Response('sessionId required', { status: 400 });
  }

  const session = execSessionManager.getSession(sessionId);
  if (!session) {
    return new Response('Session not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connect notification
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      const onData = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'output', data })}\n\n`));
      };

      const onClose = (code: number) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'close', code })}\n\n`));
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      session.on('data', onData);
      session.on('close', onClose);

      req.signal.addEventListener('abort', () => {
        session.off('data', onData);
        session.off('close', onClose);
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
