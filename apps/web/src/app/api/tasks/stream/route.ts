import { processManager, type TaskLogEntry } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get('taskId');

  if (!taskId) {
    return new Response('Missing taskId parameter', { status: 400 });
  }

  const task = processManager.getTask(taskId);
  if (!task) {
    return new Response('Task not found', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // 1. Send initial status
      controller.enqueue(
        encoder.encode(`event: status\ndata: ${JSON.stringify({ status: task.status })}\n\n`)
      );

      // 2. Stream existing buffered logs
      for (const log of task.logs) {
        controller.enqueue(
          encoder.encode(`event: log\ndata: ${JSON.stringify(log)}\n\n`)
        );
      }

      // If task already ended, send close event and close stream
      if (task.status !== 'running') {
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({
              status: task.status,
              exitCode: task.exitCode,
            })}\n\n`
          )
        );
        controller.close();
        return;
      }

      // 3. Listen for new logs
      const onLog = (entry: TaskLogEntry) => {
        try {
          controller.enqueue(
            encoder.encode(`event: log\ndata: ${JSON.stringify(entry)}\n\n`)
          );
        } catch {
          cleanup();
        }
      };

      const onClose = (code: number | null) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({
                status: task.status,
                exitCode: code,
              })}\n\n`
            )
          );
          controller.close();
        } finally {
          cleanup();
        }
      };

      const cleanup = () => {
        task.emitter.off('log', onLog);
        task.emitter.off('close', onClose);
      };

      task.emitter.on('log', onLog);
      task.emitter.on('close', onClose);

      req.signal.addEventListener('abort', () => {
        cleanup();
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
