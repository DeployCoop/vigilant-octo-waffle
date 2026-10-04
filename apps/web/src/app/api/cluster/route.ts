import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { ClusterOrchestrator, K8sClient } from '@vow/orchestrator';
import { withAuthz } from '@/lib/authz';

export async function GET() {
  try {
    const root = getProjectRoot();
    const orchestrator = new ClusterOrchestrator(root);
    const status = orchestrator.getStatus();

    const k8s = new K8sClient();
    const telemetry = await k8s.getTelemetry();

    const effectivePlatform =
      telemetry.isConnected && telemetry.detectedPlatform !== 'unknown'
        ? telemetry.detectedPlatform
        : status.platform;

    const effectiveName =
      telemetry.isConnected && telemetry.detectedClusterName
        ? telemetry.detectedClusterName
        : status.name;

    return NextResponse.json({
      ...status,
      platform: effectivePlatform,
      name: effectiveName,
      isRunning: telemetry.isConnected,
      telemetry,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Critical permission: starting a cluster.
export const POST = withAuthz('cluster:manage', async (req: Request) => {
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
});

// Critical permission: tearing a cluster down.
export const DELETE = withAuthz('cluster:manage', async () => {
  try {
    const root = getProjectRoot();
    const orchestrator = new ClusterOrchestrator(root);

    const k8s = new K8sClient();
    const telemetry = await k8s.getTelemetry();
    const activePlatform =
      telemetry.isConnected && telemetry.detectedPlatform !== 'unknown'
        ? telemetry.detectedPlatform
        : undefined;

    const task = orchestrator.stopCluster(activePlatform, telemetry.detectedClusterName || undefined);

    return NextResponse.json({
      success: true,
      taskId: task.id,
      command: `${task.command} ${task.args.join(' ')}`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
});
