import { NextResponse } from 'next/server';
import {
  K8sClient,
  getK3sStorageStatus,
  installK3sStorage,
  testK3sStorageBenchmark,
  snapshotK3sVolume,
} from '@vow/orchestrator';
import { getProjectRoot } from '@/lib/project';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'storage:manage');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const k8sClient = new K8sClient();
    const [storage, k3sStorage] = await Promise.all([
      k8sClient.getStorage(),
      getK3sStorageStatus(root).catch(() => null),
    ]);

    return NextResponse.json({
      ...storage,
      openEBS: k3sStorage,
    });
  } catch (err) {
    return routeError(err, { route: 'GET /api/storage' });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'storage:manage');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const body = await req.json();
    const { action } = body;

    if (action === 'configure-openebs') {
      const task = installK3sStorage(root, {
        engine: 'openebs',
        ...body.options,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `OpenEBS reconfiguration started (Task: ${task.id})`,
      });
    }

    if (action === 'benchmark') {
      const sc = body.storageClass || 'openebs-lvmpv';
      const task = testK3sStorageBenchmark(root, sc);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Storage benchmark started on '${sc}' (Task: ${task.id})`,
      });
    }

    if (action === 'snapshot') {
      const task = snapshotK3sVolume(root, body.pvcName, body.snapshotName);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Volume snapshot initiated for '${body.pvcName}' (Task: ${task.id})`,
      });
    }

    if (action === 'label-nodes') {
      const key = body.key || 'openebs.io/lvm';
      const val = body.value || 'true';
      await execAsync(`kubectl label nodes --all ${key}=${val} --overwrite`);
      return NextResponse.json({
        success: true,
        message: `Cluster nodes successfully labeled with ${key}=${val}`,
      });
    }

    if (action === 'set-default-sc') {
      const targetSc = body.storageClass;
      if (!targetSc) {
        return apiError(400, 'StorageClass name required');
      }
      // Remove default annotation from any existing default SCs
      await execAsync(
        `kubectl get sc -o jsonpath='{.items[?(@.metadata.annotations.storageclass\\.kubernetes\\.io/is-default-class=="true")].metadata.name}' | xargs -r -n1 kubectl annotate sc --overwrite storageclass.kubernetes.io/is-default-class=false`
      ).catch(() => {});
      // Set default on the target SC
      await execAsync(
        `kubectl annotate sc ${targetSc} --overwrite storageclass.kubernetes.io/is-default-class=true`
      );
      return NextResponse.json({
        success: true,
        message: `StorageClass '${targetSc}' set as cluster default`,
      });
    }

    return apiError(400, `Unknown action '${action}'`);
  } catch (err: any) {
    return routeError(err, { route: 'POST /api/storage' });
  }
}
