import { NextResponse } from 'next/server';
import { processManager } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'tasks:read');
  if (denied) return denied;

  try {
    const tasks = processManager.getAllTasks().map((t) => ({
      id: t.id,
      command: t.command,
      args: t.args,
      status: t.status,
      exitCode: t.exitCode,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      logCount: t.logs.length,
    }));

    return NextResponse.json({ tasks });
  } catch (err) {
    return routeError(err, { route: 'GET /api/tasks' });
  }
}

export async function DELETE(req: Request) {
  try {
    const { taskId } = await req.json();

    // Cancelling a running task is a task action, not a read.
    const denied = await authorizeRequest(req, 'tasks:run');
    if (denied) return denied;

    if (!taskId) {
      return apiError(400, 'Missing taskId');
    }

    const cancelled = processManager.cancelTask(taskId);
    return NextResponse.json({ success: cancelled });
  } catch (err) {
    return routeError(err, { route: 'DELETE /api/tasks' });
  }
}
