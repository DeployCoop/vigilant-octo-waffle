import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { ClusterOrchestrator, K8sClient } from '@vow/orchestrator';

export async function GET() {
  try {
    const root = getProjectRoot();
    const orchestrator = new ClusterOrchestrator(root);
    const status = orchestrator.getStatus();

    const k8s = new K8sClient();
    const telemetry = await k8s.getTelemetry();

    return NextResponse.json({
      ...status,
      isRunning: telemetry.isConnected,
      telemetry,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json().catch(() => ({}));
    const orchestrator = new ClusterOrchestrator(root);

    let task;
    if (body.action === 'up') {
      task = orchestrator.runFullDeployment();
    } else {
      task = orchestrator.startCluster();
    }

    return NextResponse.json({
      success: true,
      taskId: task.id,
      command: `${task.command} ${task.args.join(' ')}`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const root = getProjectRoot();
    const orchestrator = new ClusterOrchestrator(root);
    const task = orchestrator.stopCluster();

    return NextResponse.json({
      success: true,
      taskId: task.id,
      command: `${task.command} ${task.args.join(' ')}`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
