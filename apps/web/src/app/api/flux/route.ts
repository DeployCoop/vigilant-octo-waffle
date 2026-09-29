import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { loadProjectConfig, saveEnvFile, K8sClient, FluxManager, processManager } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const fluxNs = config.cluster.fluxNamespace || 'flux-system';

    const k8s = new K8sClient();
    const pods = await k8s.getPods(fluxNs);

    const controllers = [
      'source-controller',
      'helm-controller',
      'kustomize-controller',
      'notification-controller',
    ].map((ctrlName) => {
      const matchingPod = pods.find((p) => p.name.includes(ctrlName));
      return {
        name: ctrlName,
        podName: matchingPod?.name || null,
        status: matchingPod?.status || 'Not Found',
        ready: matchingPod?.ready || '0/1',
        restarts: matchingPod?.restarts || 0,
      };
    });

    const isHealthy = controllers.length > 0 && controllers.every((c) => c.status === 'Running');

    return NextResponse.json({
      cdRunner: config.cluster.cdRunner,
      fluxNamespace: fluxNs,
      isHealthy,
      controllers,
      totalControllers: controllers.length,
      activeControllers: controllers.filter((c) => c.status === 'Running').length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const fluxNs = config.cluster.fluxNamespace || 'flux-system';
    const body = await req.json().catch(() => ({}));
    const { action, name, namespace, cdRunner } = body;

    if (action === 'set-runner' && cdRunner) {
      if (!['argocd', 'flux', 'both'].includes(cdRunner)) {
        return NextResponse.json({ error: 'Invalid cdRunner value. Allowed: argocd, flux, both' }, { status: 400 });
      }
      saveEnvFile(root, { ...config.raw, THIS_CD_RUNNER: cdRunner });
      return NextResponse.json({
        success: true,
        cdRunner,
        message: `GitOps CD Runner updated to: ${cdRunner}`,
      });
    }

    if (action === 'bootstrap') {
      const fluxManager = new FluxManager(root);
      const task = fluxManager.bootstrapFlux();
      return NextResponse.json({
        success: true,
        taskId: task.id,
        action: 'bootstrap',
        message: 'FluxCD bootstrap initiated via src/flux.sh',
      });
    }

    const targetNs = namespace || config.cluster.namespace || 'default';
    const now = String(Date.now());

    if (action === 'reconcile-all') {
      const task = processManager.runCommand(
        'kubectl',
        ['annotate', '--all', 'helmrelease', '-n', targetNs, `reconcile.fluxcd.io/requestedAt=${now}`, '--overwrite'],
        { cwd: root, env: config.raw }
      );
      return NextResponse.json({
        success: true,
        taskId: task.id,
        action: 'reconcile-all',
        message: 'Reconciliation initiated across all Flux resources',
      });
    }

    if (action === 'reconcile' && name) {
      const task = processManager.runCommand(
        'kubectl',
        ['annotate', '--overwrite', 'helmrelease', name, '-n', targetNs, `reconcile.fluxcd.io/requestedAt=${now}`],
        { cwd: root, env: config.raw }
      );
      return NextResponse.json({ success: true, taskId: task.id, app: name });
    }

    return NextResponse.json({ error: 'Invalid action. Allowed: bootstrap, set-runner, reconcile, reconcile-all' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
