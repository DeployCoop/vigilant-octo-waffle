import { NextResponse } from 'next/server';
import { processManager } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { taskId } = await req.json();

    // Cancelling a running task is a task action, not a read.
    const denied = await authorizeRequest(req, 'tasks:run');
    if (denied) return denied;

    if (!taskId) {
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
    }

    const cancelled = processManager.cancelTask(taskId);
    return NextResponse.json({ success: cancelled });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
