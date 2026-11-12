import { NextResponse } from 'next/server';
import { processManager, redactSensitiveArgs } from '@vow/orchestrator';
import { authorizeRequest, canViewTask, resolveAuthzContext } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'tasks:read');
  if (denied) return denied;

  try {
    // Task scoping (bug-hunt Batch A5): a caller sees their own tasks
    // plus system tasks; owner/admin see everything. Args go through
    // the same redaction as the task log line, so a live task's argv
    // cannot leak a credential even before it is persisted.
    const { principal } = await resolveAuthzContext(req);
    const tasks = processManager
      .getAllTasks()
      .filter((t) => canViewTask(t.principalId, principal))
      .map((t) => ({
        id: t.id,
        command: t.command,
        args: redactSensitiveArgs(t.args),
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
