import { NextResponse } from 'next/server';
import {
  K8sClient,
  getK3sStorageStatus,
  installK3sStorage,
  testK3sStorageBenchmark,
  snapshotK3sVolume,
  loadProjectConfig,
  saveEnvFile,
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
    const config = loadProjectConfig(root);
    const [storage, k3sStorage] = await Promise.all([
      k8sClient.getStorage(),
      getK3sStorageStatus(root).catch(() => null),
    ]);

    const configuredEngines = {
      lvm: config.raw.THIS_OPENEBS_ENGINE_LVM !== 'false',
      hostpath: config.raw.THIS_OPENEBS_ENGINE_HOSTPATH !== 'false',
      zfs: config.raw.THIS_OPENEBS_ENGINE_ZFS === 'true',
      rawfile: config.raw.THIS_OPENEBS_ENGINE_RAWFILE === 'true',
      mayastor: config.raw.THIS_OPENEBS_ENGINE_MAYASTOR === 'true',
      nats: config.raw.THIS_OPENEBS_ENABLE_NATS === 'true',
      minio: config.raw.THIS_OPENEBS_ENABLE_MINIO === 'true',
      loki: config.raw.THIS_OPENEBS_ENABLE_LOKI === 'true',
      alloy: config.raw.THIS_OPENEBS_ENABLE_ALLOY === 'true',
      nfs: config.raw.THIS_OPENEBS_INSTALL_NFS === 'true',
    };

    const openEBSData = k3sStorage ? {
      ...k3sStorage,
      configuredEngines,
      config: {
        ...k3sStorage.config,
        vg: config.raw.THIS_LVM_VG || k3sStorage.config?.vg || 'AirVG',
        fsType: config.raw.THIS_LVM_FSTYPE || k3sStorage.config?.fsType || 'ext4',
        thinProvision: config.raw.THIS_LVM_THIN_PROVISION || k3sStorage.config?.thinProvision || 'no',
        shared: config.raw.THIS_LVM_SHARED || k3sStorage.config?.shared || 'yes',
        storageClass: config.raw.THIS_LVM_STORAGECLASS || k3sStorage.config?.storageClass || 'openebs-lvmpv',
        isDefaultSc: config.raw.THIS_LVM_IS_DEFAULT_SC || k3sStorage.config?.isDefaultSc || 'false',
      },
    } : null;

    return NextResponse.json({
      ...storage,
      openEBS: openEBSData,
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
      const cfg = loadProjectConfig(root);
      const updatedEnv: Record<string, string> = {
        ...cfg.raw,
      };
      if (body.options?.vg) updatedEnv['THIS_LVM_VG'] = String(body.options.vg);
      if (body.options?.fsType) updatedEnv['THIS_LVM_FSTYPE'] = String(body.options.fsType);
      if (body.options?.thinProvision !== undefined) {
        updatedEnv['THIS_LVM_THIN_PROVISION'] = body.options.thinProvision ? 'yes' : 'no';
      }
      if (body.options?.shared !== undefined) {
        updatedEnv['THIS_LVM_SHARED'] = body.options.shared ? 'yes' : 'no';
      }
      if (body.options?.enableLvm !== undefined) {
        updatedEnv['THIS_OPENEBS_ENGINE_LVM'] = String(body.options.enableLvm);
      }
      if (body.options?.enableHostpath !== undefined) {
        updatedEnv['THIS_OPENEBS_ENGINE_HOSTPATH'] = String(body.options.enableHostpath);
      }
      if (body.options?.enableZfs !== undefined) {
        updatedEnv['THIS_OPENEBS_ENGINE_ZFS'] = String(body.options.enableZfs);
      }
      if (body.options?.enableRawfile !== undefined) {
        updatedEnv['THIS_OPENEBS_ENGINE_RAWFILE'] = String(body.options.enableRawfile);
      }
      if (body.options?.enableMayastor !== undefined) {
        updatedEnv['THIS_OPENEBS_ENGINE_MAYASTOR'] = String(body.options.enableMayastor);
      }
      if (body.options?.enableNats !== undefined) {
        updatedEnv['THIS_OPENEBS_ENABLE_NATS'] = String(body.options.enableNats);
      }
      if (body.options?.enableMinio !== undefined) {
        updatedEnv['THIS_OPENEBS_ENABLE_MINIO'] = String(body.options.enableMinio);
      }
      if (body.options?.enableLoki !== undefined) {
        updatedEnv['THIS_OPENEBS_ENABLE_LOKI'] = String(body.options.enableLoki);
      }
      if (body.options?.enableAlloy !== undefined) {
        updatedEnv['THIS_OPENEBS_ENABLE_ALLOY'] = String(body.options.enableAlloy);
      }
      if (body.options?.enableNfs !== undefined) {
        updatedEnv['THIS_OPENEBS_INSTALL_NFS'] = String(body.options.enableNfs);
      }
      if (body.options?.setDefaultSc !== undefined) {
        updatedEnv['THIS_LVM_IS_DEFAULT_SC'] = String(body.options.setDefaultSc);
      }
      saveEnvFile(root, updatedEnv);

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
      const cfg = loadProjectConfig(root);
      const isLvmDefault = targetSc === (cfg.raw['THIS_LVM_STORAGECLASS'] || 'openebs-lvmpv');
      saveEnvFile(root, {
        ...cfg.raw,
        THIS_STORAGE_DEFAULT_CLASS: targetSc,
        THIS_LVM_IS_DEFAULT_SC: isLvmDefault ? 'true' : 'false',
      });
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
