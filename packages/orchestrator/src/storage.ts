import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProjectConfig } from './config.js';
import { substituteVariables } from './template.js';
import { applyInitializerDirectory } from './initializer.js';
import { ensureNamespaceWithSecurity } from './namespaces.js';

const execAsync = promisify(exec);

export type StorageEngine = 'openebs' | 'longhorn' | 'nfs' | 'seaweedfs' | 'rook-ceph' | 'local-path';

export interface StoragePrereqCheck {
  name: string;
  category: 'kernel' | 'tool' | 'service';
  passed: boolean;
  message: string;
}

export interface StorageBenchmarkResult {
  storageClass: string;
  writeSpeedMbSec: number;
  iops?: number;
  latencyMs?: number;
  durationSeconds: number;
  success: boolean;
  rawLog?: string;
  error?: string;
}

export interface StorageStatusReport {
  primaryEngine: string;
  storageClasses: Array<{
    name: string;
    provisioner: string;
    reclaimPolicy: string;
    isDefault: boolean;
  }>;
  volumeSnapshotClasses: string[];
  totalPVs: number;
  boundPVCs: number;
  unboundPVCs: number;
  hostVolumeGroups: string[];
  prereqs: StoragePrereqCheck[];
}

/**
 * Validates host kernel modules and system packages required for storage engines
 */
export async function validateStorageHostPrereqs(): Promise<StoragePrereqCheck[]> {
  const checks: StoragePrereqCheck[] = [];

  // Check kernel modules
  try {
    const { stdout } = await execAsync('lsmod');
    checks.push({
      name: 'dm_mod (LVM Device Mapper)',
      category: 'kernel',
      passed: stdout.includes('dm_mod'),
      message: stdout.includes('dm_mod') ? 'Kernel module loaded' : 'Module not loaded. Run: modprobe dm_mod',
    });
    checks.push({
      name: 'nvme_tcp (NVMe-oF Mayastor)',
      category: 'kernel',
      passed: stdout.includes('nvme_tcp'),
      message: stdout.includes('nvme_tcp') ? 'NVMe-oF TCP module loaded' : 'Module not loaded (optional, only for Mayastor)',
    });
  } catch {
    checks.push({
      name: 'kernel-modules',
      category: 'kernel',
      passed: false,
      message: 'Failed to query lsmod',
    });
  }

  // Check CLI utilities
  const tools = [
    { cmd: 'vgs', name: 'LVM2 Tools (vgs)', category: 'tool' as const },
    { cmd: 'mkfs.ext4', name: 'Filesystem tools (e2fsprogs)', category: 'tool' as const },
    { cmd: 'iscsiadm', name: 'Open-iSCSI (iscsiadm)', category: 'tool' as const },
    { cmd: 'showmount', name: 'NFS Client (nfs-common)', category: 'tool' as const },
  ];

  for (const t of tools) {
    try {
      await execAsync(`command -v ${t.cmd}`);
      checks.push({
        name: t.name,
        category: t.category,
        passed: true,
        message: 'Binary available on host PATH',
      });
    } catch {
      checks.push({
        name: t.name,
        category: t.category,
        passed: false,
        message: `Command '${t.cmd}' not found on host`,
      });
    }
  }

  return checks;
}

/**
 * Auto-detects local LVM Volume Groups on host
 */
export async function detectHostVolumeGroups(): Promise<string[]> {
  try {
    const { stdout } = await execAsync('vgs --noheadings -o vg_name 2>/dev/null');
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function getStorageExecutionEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KUBECONFIG: process.env.KUBECONFIG || (fs.existsSync('/etc/rancher/k3s/k3s.yaml') ? '/etc/rancher/k3s/k3s.yaml' : undefined),
  };
}

/**
 * Applies topology labels to Kubernetes cluster nodes
 */
export async function labelNodesForStorage(
  projectRoot: string,
  key = 'openebs.io/lvm',
  value = 'true'
): Promise<string[]> {
  const labeledNodes: string[] = [];
  try {
    const env = getStorageExecutionEnv();
    const { stdout } = await execAsync("kubectl get nodes -o jsonpath='{.items[*].metadata.name}'", { cwd: projectRoot, env });
    const nodes = stdout.trim().split(/\s+/).filter(Boolean);

    for (const node of nodes) {
      await execAsync(`kubectl label node ${JSON.stringify(node)} ${JSON.stringify(`${key}=${value}`)} --overwrite`, { cwd: projectRoot, env });
      labeledNodes.push(node);
    }
  } catch {
    // If kubectl not configured or cluster offline
  }
  return labeledNodes;
}

export interface OpenEbsStatus {
  isReady: boolean;
  storageClasses: string[];
  readyDeployments: string[];
  runningPods: number;
  message: string;
}

/**
 * Probes the cluster to determine whether OpenEBS StorageClasses and Provisioner
 * deployments/pods are already installed, active, and healthy.
 */
export async function checkOpenEbsStatus(projectRoot?: string): Promise<OpenEbsStatus> {
  const cwd = projectRoot || process.cwd();
  const storageClasses: string[] = [];
  const readyDeployments: string[] = [];
  let runningPods = 0;
  const env = getStorageExecutionEnv();

  // 1. Detect StorageClasses provisioned by OpenEBS (e.g., openebs-hostpath, openebs.io/local)
  try {
    const { stdout } = await execAsync('kubectl get sc -o json', { cwd, env });
    const parsed = JSON.parse(stdout);
    for (const item of parsed.items || []) {
      const name: string = item.metadata?.name || '';
      const provisioner: string = item.provisioner || '';
      if (name.includes('openebs') || provisioner.includes('openebs') || provisioner.includes('mayastor')) {
        storageClasses.push(name);
      }
    }
  } catch {
    // Cluster may be offline or kubectl not configured
  }

  // 2. Detect Deployments in the openebs namespace
  try {
    const { stdout } = await execAsync('kubectl get deployment -n openebs -o json', { cwd, env });
    const parsed = JSON.parse(stdout);
    for (const item of parsed.items || []) {
      const name: string = item.metadata?.name || '';
      const readyReplicas: number = item.status?.readyReplicas || 0;
      if (readyReplicas > 0) {
        readyDeployments.push(`${name} (${readyReplicas}/${item.status?.replicas || 1})`);
      }
    }
  } catch {
    // openebs namespace might not exist
  }

  // 3. Count running pods in openebs namespace
  try {
    const { stdout } = await execAsync('kubectl get pods -n openebs --field-selector=status.phase=Running --no-headers', { cwd, env });
    runningPods = stdout.trim().split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    // openebs namespace might not exist
  }

  // OpenEBS is considered ready if:
  // - Any OpenEBS storage class exists AND at least one OpenEBS deployment is ready or pods are running
  // - OR an OpenEBS localpv-provisioner deployment is ready
  // A StorageClass alone is NOT sufficient: init/openebs can apply StorageClasses without
  // the Helm release ever being installed, leaving no provisioner/CSI pods running.
  const hasStorageClass = storageClasses.length > 0;
  const hasProvisioner = readyDeployments.some((d) => d.toLowerCase().includes('provisioner')) || runningPods > 0;
  const isReady = hasStorageClass && hasProvisioner;

  const message = isReady
    ? `OpenEBS is active and ready: StorageClasses=[${storageClasses.join(', ')}], Deployments=[${readyDeployments.join(', ')}], RunningPods=${runningPods}`
    : `OpenEBS not detected or incomplete (StorageClasses=${storageClasses.length}, Deployments=${readyDeployments.length}, RunningPods=${runningPods})`;

  return {
    isReady,
    storageClasses,
    readyDeployments,
    runningPods,
    message,
  };
}

/**
 * Simple boolean check whether OpenEBS is already installed and healthy
 */
export async function isOpenEbsInstalledAndReady(projectRoot?: string): Promise<boolean> {
  const status = await checkOpenEbsStatus(projectRoot);
  return status.isReady;
}

/**
 * Deploys OpenEBS Storage Fabric (LocalPV, LVM, ZFS, NFS)
 */
export async function deployOpenEBS(
  projectRoot: string,
  options: {
    namespace?: string;
    engine?: 'localpv' | 'lvm' | 'mayastor';
    vgName?: string;
    labelNodes?: boolean;
    installNfs?: boolean;
    timeout?: string;
    force?: boolean;
  } = {}
): Promise<{ success: boolean; output: string }> {
  const config = loadProjectConfig(projectRoot);
  const namespace = options.namespace || config.raw.THIS_OPENEBS_NAMESPACE || 'openebs';
  const timeout = options.timeout || '10m0s';

  // 0. Check if OpenEBS is already up and healthy to prevent immutable field upgrade errors
  if (!options.force) {
    const existingStatus = await checkOpenEbsStatus(projectRoot);
    if (existingStatus.isReady) {
      await applyInitializerDirectory(projectRoot, 'init/openebs').catch(() => {});
      if (options.installNfs || config.raw.THIS_OPENEBS_INSTALL_NFS === 'true') {
        await ensureNamespaceWithSecurity(projectRoot, 'nfs-server', {
          enforce: 'baseline',
          audit: 'restricted',
          warn: 'restricted',
        }).catch(() => {});
        await applyInitializerDirectory(projectRoot, 'init/openebs-nfs').catch(() => {});
      }
      return {
        success: true,
        output: `OpenEBS is already installed and healthy: ${existingStatus.message}. Skipped helm upgrade to prevent immutable field conflicts.`,
      };
    }
  }

  // 1. Ensure Namespace
  await ensureNamespaceWithSecurity(projectRoot, namespace, {
    enforce: 'privileged',
    audit: 'privileged',
    warn: 'privileged',
  });

  // 2. Auto-detect LVM volume group
  let vg = options.vgName || config.raw.THIS_LVM_VG;
  if (!vg || vg.includes('exampleVG')) {
    const hostVgs = await detectHostVolumeGroups();
    if (hostVgs.length > 0) {
      vg = hostVgs[0];
    }
  }

  // 3. Label nodes if requested
  if (options.labelNodes ?? (config.raw.THIS_OPENEBS_LVM_LABEL_NODES !== 'false')) {
    const topoKey = config.raw.THIS_OPENEBS_LVM_TOPOLOGY_KEY || 'openebs.io/lvm';
    const topoVal = config.raw.THIS_OPENEBS_LVM_TOPOLOGY_VALUE || 'true';
    await labelNodesForStorage(projectRoot, topoKey, topoVal);
  }

  // 4. Render values
  const tplPath = path.join(projectRoot, 'src', 'openebs-values.tpl');
  let valuesYaml = '';
  if (fs.existsSync(tplPath)) {
    const raw = fs.readFileSync(tplPath, 'utf-8');
    valuesYaml = substituteVariables(raw, {
      ...config.raw,
      THIS_LVM_VG: vg || 'defaultVG',
      THIS_OPENEBS_NAMESPACE: namespace,
    }, { preserveUnknown: true });
  }

  const cacheDir = path.join(projectRoot, '.vow-cache', 'storage');
  fs.mkdirSync(cacheDir, { recursive: true });
  const valuesFile = path.join(cacheDir, 'openebs-values.yaml');
  fs.writeFileSync(valuesFile, valuesYaml, 'utf-8');

  // 5. Ensure Helm repository
  await execAsync('helm repo add openebs https://openebs.github.io/openebs 2>/dev/null || true', { cwd: projectRoot });
  await execAsync('helm repo update openebs 2>/dev/null || true', { cwd: projectRoot });

  const releaseName = `openebs-${config.raw.THIS_NAME || 'default'}`;
  const cmd = [
    `helm upgrade --install ${JSON.stringify(releaseName)} openebs/openebs`,
    `--namespace ${JSON.stringify(namespace)}`,
    '--create-namespace',
    `--timeout ${JSON.stringify(timeout)}`,
    `-f ${JSON.stringify(valuesFile)}`,
  ].join(' ');

  const executionEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...config.raw,
    KUBECONFIG: process.env.KUBECONFIG || (fs.existsSync('/etc/rancher/k3s/k3s.yaml') ? '/etc/rancher/k3s/k3s.yaml' : undefined),
  };

  let stdout = '';
  let stderr: string;
  try {
    const res = await execAsync(cmd, { cwd: projectRoot, env: executionEnv });
    stdout = res.stdout;
    stderr = res.stderr;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (
      errMsg.includes('field is immutable') ||
      errMsg.includes('cannot patch') ||
      errMsg.includes('meta.helm.sh/release-name') ||
      errMsg.includes('rendered manifests contain a resource that already exists') ||
      errMsg.includes('timed out waiting for the condition')
    ) {
      const fallbackCheck = await checkOpenEbsStatus(projectRoot);
      if (fallbackCheck.isReady) {
        stderr = `Warning: Helm upgrade encountered existing installation conflict or timeout (${errMsg.split('\n')[0]}), but OpenEBS was verified operational: ${fallbackCheck.message}`;
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  // 6. Apply init/openebs StorageClasses
  await applyInitializerDirectory(projectRoot, 'init/openebs');

  // 7. Optional NFS server fabric
  if (options.installNfs || config.raw.THIS_OPENEBS_INSTALL_NFS === 'true') {
    await ensureNamespaceWithSecurity(projectRoot, 'nfs-server', {
      enforce: 'baseline',
      audit: 'restricted',
      warn: 'restricted',
    });
    await applyInitializerDirectory(projectRoot, 'init/openebs-nfs');
  }

  return {
    success: true,
    output: (stdout + '\n' + stderr).trim(),
  };
}

/**
 * Deploys Kubernetes CSI Driver for NFS
 */
export async function deployCsiDriverNfs(
  projectRoot: string
): Promise<{ success: boolean; output: string }> {
  const config = loadProjectConfig(projectRoot);

  await applyInitializerDirectory(projectRoot, 'init/pre-csi-nfs');

  await execAsync('helm repo add csi-driver-nfs https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts 2>/dev/null || true', { cwd: projectRoot });
  await execAsync('helm repo update csi-driver-nfs 2>/dev/null || true', { cwd: projectRoot });

  const cmd = [
    'helm upgrade --install csi-driver-nfs csi-driver-nfs/csi-driver-nfs',
    '--namespace kube-system',
    '--wait',
    '--timeout 10m0s',
  ].join(' ');

  const executionEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...config.raw,
    KUBECONFIG: process.env.KUBECONFIG || (fs.existsSync('/etc/rancher/k3s/k3s.yaml') ? '/etc/rancher/k3s/k3s.yaml' : undefined),
  };
  const { stdout, stderr } = await execAsync(cmd, { cwd: projectRoot, env: executionEnv });
  return {
    success: true,
    output: (stdout + '\n' + stderr).trim(),
  };
}

/**
 * Runs a performance benchmark (write speed and latency) against a specified StorageClass
 */
export async function runStorageBenchmark(
  projectRoot: string,
  storageClass: string = 'local-path',
  sizeGi: number = 1
): Promise<StorageBenchmarkResult> {
  const id = `bench-${Date.now().toString(36)}`;
  const pvcName = `pvc-${id}`;
  const podName = `pod-${id}`;
  const namespace = 'default';

  const pvcYaml = `
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${pvcName}
  namespace: ${namespace}
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: ${storageClass}
  resources:
    requests:
      storage: ${sizeGi}Gi
`;

  const podYaml = `
apiVersion: v1
kind: Pod
metadata:
  name: ${podName}
  namespace: ${namespace}
spec:
  restartPolicy: Never
  volumes:
    - name: bench-vol
      persistentVolumeClaim:
        claimName: ${pvcName}
  containers:
    - name: benchmark
      image: alpine:latest
      command: ["/bin/sh", "-c"]
      args:
        - |
          echo "Starting disk benchmark on ${storageClass}..."
          start_time=$(date +%s%N)
          dd if=/dev/zero of=/data/test.bin bs=1M count=100 conv=fdatasync 2>&1
          end_time=$(date +%s%N)
          duration=$(( (end_time - start_time) / 1000000 ))
          echo "BENCHMARK_COMPLETED duration_ms=\${duration}"
          rm -f /data/test.bin
      volumeMounts:
        - name: bench-vol
          mountPath: /data
`;

  const cleanup = async () => {
    await execAsync(`kubectl delete pod ${podName} -n ${namespace} --ignore-not-found --now`, { cwd: projectRoot }).catch(() => {});
    await execAsync(`kubectl delete pvc ${pvcName} -n ${namespace} --ignore-not-found --now`, { cwd: projectRoot }).catch(() => {});
  };

  try {
    // 1. Create PVC
    await new Promise<void>((resolve, reject) => {
      const proc = exec('kubectl apply -f -', { cwd: projectRoot }, (err) => (err ? reject(err) : resolve()));
      proc.stdin?.write(pvcYaml);
      proc.stdin?.end();
    });

    // 2. Create Pod
    await new Promise<void>((resolve, reject) => {
      const proc = exec('kubectl apply -f -', { cwd: projectRoot }, (err) => (err ? reject(err) : resolve()));
      proc.stdin?.write(podYaml);
      proc.stdin?.end();
    });

    // 3. Wait for pod completion (up to 90s)
    await execAsync(`kubectl wait --for=condition=Ready=false pod/${podName} -n ${namespace} --timeout=90s`, { cwd: projectRoot });

    // 4. Fetch logs
    const { stdout: logs } = await execAsync(`kubectl logs ${podName} -n ${namespace}`, { cwd: projectRoot });

    // Parse dd output: e.g. "104857600 bytes (105 MB, 100 MiB) copied, 0.428781 s, 245 MB/s"
    let speed = 0;
    const speedMatch = logs.match(/(\d+(?:\.\d+)?)\s+([MGK]B\/s)/i);
    if (speedMatch) {
      speed = parseFloat(speedMatch[1]);
      if (speedMatch[2].toUpperCase().startsWith('G')) speed *= 1024;
      else if (speedMatch[2].toUpperCase().startsWith('K')) speed /= 1024;
    }

    let durationSec = 1;
    const durMatch = logs.match(/duration_ms=(\d+)/);
    if (durMatch) {
      durationSec = Math.max(0.1, parseInt(durMatch[1], 10) / 1000);
    }

    await cleanup();

    return {
      storageClass,
      writeSpeedMbSec: Math.round(speed * 10) / 10,
      iops: Math.round((speed * 1024) / 4), // Approx 4K IOPS equivalent
      latencyMs: Math.round((durationSec / 100) * 1000 * 10) / 10,
      durationSeconds: Math.round(durationSec * 10) / 10,
      success: true,
      rawLog: logs,
    };
  } catch (err: any) {
    await cleanup();
    return {
      storageClass,
      writeSpeedMbSec: 0,
      durationSeconds: 0,
      success: false,
      error: err.message,
    };
  }
}

/**
 * Retrieves the comprehensive storage fabric status of the cluster
 */
export async function getStorageFabricStatus(projectRoot: string): Promise<StorageStatusReport> {
  const config = loadProjectConfig(projectRoot);
  const primaryEngine = config.raw.STORAGE_ENGINE || 'local-path';

  const [vgs, prereqs] = await Promise.all([
    detectHostVolumeGroups(),
    validateStorageHostPrereqs(),
  ]);

  const report: StorageStatusReport = {
    primaryEngine,
    storageClasses: [],
    volumeSnapshotClasses: [],
    totalPVs: 0,
    boundPVCs: 0,
    unboundPVCs: 0,
    hostVolumeGroups: vgs,
    prereqs,
  };

  try {
    // StorageClasses
    const { stdout: scOut } = await execAsync('kubectl get sc -o json', { cwd: projectRoot }).catch(() => ({ stdout: '{"items":[]}' }));
    const scData = JSON.parse(scOut);
    report.storageClasses = (scData.items || []).map((sc: any) => ({
      name: sc.metadata?.name || '',
      provisioner: sc.provisioner || '',
      reclaimPolicy: sc.reclaimPolicy || 'Delete',
      isDefault: sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
    }));

    // VolumeSnapshotClasses
    const { stdout: vscOut } = await execAsync('kubectl get volumesnapshotclass -o json', { cwd: projectRoot }).catch(() => ({ stdout: '{"items":[]}' }));
    const vscData = JSON.parse(vscOut);
    report.volumeSnapshotClasses = (vscData.items || []).map((v: any) => v.metadata?.name || '');

    // PVs
    const { stdout: pvOut } = await execAsync('kubectl get pv -o json', { cwd: projectRoot }).catch(() => ({ stdout: '{"items":[]}' }));
    const pvData = JSON.parse(pvOut);
    report.totalPVs = (pvData.items || []).length;

    // PVCs
    const { stdout: pvcOut } = await execAsync('kubectl get pvc -A -o json', { cwd: projectRoot }).catch(() => ({ stdout: '{"items":[]}' }));
    const pvcData = JSON.parse(pvcOut);
    for (const pvc of pvcData.items || []) {
      if (pvc.status?.phase === 'Bound') report.boundPVCs++;
      else report.unboundPVCs++;
    }
  } catch {
    // Cluster offline
  }

  return report;
}
