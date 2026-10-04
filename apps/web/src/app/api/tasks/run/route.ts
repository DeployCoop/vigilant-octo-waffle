import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { processManager, loadProjectConfig, validateCommand } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export async function POST(req: Request) {
  // Running arbitrary (allowlisted) commands is the core tasks:run action.
  const denied = await authorizeRequest(req, 'tasks:run');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const body = await req.json().catch(() => ({}));
    const { command, args } = body;

    if (!command || typeof command !== 'string') {
      return apiError(400, 'Valid command string required');
    }

    const cleanArgs = Array.isArray(args) ? args.map(String) : [];

    const validation = validateCommand(command, cleanArgs, root);
    if (!validation.allowed) {
      return apiError(400, `Command rejected by orchestrator allowlist: ${validation.reason}`);
    }

    const task = processManager.runCommand(command, cleanArgs, {
      cwd: root,
      env: config.raw,
    });

    return NextResponse.json({
      success: true,
      taskId: task.id,
      command: `${task.command} ${(task.args || []).join(' ')}`,
    });
  } catch (err) {
    return routeError(err, { route: 'POST /api/tasks/run' });
  }
}
