import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { processManager, loadProjectConfig, validateCommand } from '@vow/orchestrator';

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const body = await req.json().catch(() => ({}));
    const { command, args } = body;

    if (!command || typeof command !== 'string') {
      return NextResponse.json({ error: 'Valid command string required' }, { status: 400 });
    }

    const cleanArgs = Array.isArray(args) ? args.map(String) : [];

    const validation = validateCommand(command, cleanArgs, root);
    if (!validation.allowed) {
      return NextResponse.json(
        { error: `Command rejected by orchestrator allowlist: ${validation.reason}` },
        { status: 400 }
      );
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
