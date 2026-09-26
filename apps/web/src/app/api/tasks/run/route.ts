import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { processManager, loadProjectConfig } from '@vow/orchestrator';

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const { command, args } = await req.json();

    if (!command) {
      return NextResponse.json({ error: 'Command required' }, { status: 400 });
    }

    const task = processManager.runCommand(command, args || [], {
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
