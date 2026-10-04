/**
 * K3s add-on fabrics: VIP, backups, airgap, CNI, secrets, security, storage, monitoring, GPU, model cache (WS6 split of k3s.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as path from 'node:path';
import { processManager, type TaskRun } from '../executor.js';
import { runSilentJsonQuery } from './shared.js';

export interface K3sVipOptions {
  vip?: string;
  interface?: string;
  mode?: 'arp' | 'bgp';
  version?: string;
  dryRun?: boolean;
}

export interface K3sVipStatus {
  vip: string;
  interface: string;
  localBound: boolean;
  reachable: boolean;
  manifestDeployed: boolean;
  runningPods: number;
  currentLeader: string;
}

/**
 * Deploys kube-vip floating virtual IP manifests
 */
export function setupK3sVip(projectRoot: string, options?: K3sVipOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_vip.sh');
  const args: string[] = [scriptPath, 'setup'];
  if (options?.vip) args.push('--vip', options.vip.trim());
  if (options?.interface) args.push('--interface', options.interface.trim());
  if (options?.mode) args.push('--mode', options.mode);
  if (options?.version) args.push('--version', options.version.trim());
  if (options?.dryRun) args.push('--dry-run');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

/**
 * Tears down kube-vip daemonset and manifests
 */
export function teardownK3sVip(projectRoot: string): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_vip.sh');
  return processManager.runCommand('bash', [scriptPath, 'teardown'], { cwd: projectRoot });
}

/**
 * Retrieves kube-vip floating virtual IP status
 */
export async function getK3sVipStatus(
  projectRoot: string,
  options?: { vip?: string; interface?: string }
): Promise<K3sVipStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_vip.sh');
  const args = [scriptPath, 'status', '--json'];
  if (options?.vip) args.push('--vip', options.vip.trim());
  if (options?.interface) args.push('--interface', options.interface.trim());

  return runSilentJsonQuery<K3sVipStatus>('bash', args, projectRoot, {
    vip: options?.vip || '192.168.1.100',
    interface: options?.interface || 'eth0',
    localBound: false,
    reachable: false,
    manifestDeployed: false,
    runningPods: 0,
    currentLeader: 'unknown',
  });
}

export interface K3sBackupSyncOptions {
  action?: 'push' | 'pull' | 'list' | 'restore';
  snapshotName?: string;
  endpoint?: string;
  bucket?: string;
  prefix?: string;
  key?: string;
  encrypt?: boolean;
}

/**
 * Synchronizes etcd disaster recovery snapshots to/from remote object storage
 */
export function syncK3sBackups(projectRoot: string, options?: K3sBackupSyncOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_backup_sync.sh');
  const action = options?.action || 'push';
  const args: string[] = [scriptPath, action];
  if (options?.snapshotName) args.push(options.snapshotName.trim());
  if (options?.endpoint) args.push('--endpoint', options.endpoint.trim());
  if (options?.bucket) args.push('--bucket', options.bucket.trim());
  if (options?.prefix) args.push('--prefix', options.prefix.trim());
  if (options?.key) args.push('--key', options.key.trim());
  if (options?.encrypt) args.push('--encrypt');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sAirgapOptions {
  version?: string;
  arch?: string;
  outputDir?: string;
  dryRun?: boolean;
  includeCopilot?: boolean;
}

/**
 * Builds an offline air-gapped installation bundle
 */
export function bundleK3sAirgap(projectRoot: string, options?: K3sAirgapOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_airgap.sh');
  const args: string[] = [scriptPath, 'bundle'];
  if (options?.version) args.push('--version', options.version.trim());
  if (options?.arch) args.push('--arch', options.arch.trim());
  if (options?.outputDir) args.push('--output', options.outputDir.trim());
  if (options?.dryRun) args.push('--dry-run');
  if (options?.includeCopilot) args.push('--include-copilot');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

// ==============================================================================
// Phase 2: Enterprise Security, Zero-Trust & Secrets Lifecycle
// ==============================================================================

export interface K3sCniStatus {
  activeCni: string;
  ebpfMode: boolean;
  ciliumInstalled: boolean;
  hubbleObservability: boolean;
  tetragonSecurity: boolean;
  clusterNodes: number;
}

export async function getK3sCniStatus(projectRoot: string): Promise<K3sCniStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_cni.sh');
  return runSilentJsonQuery<K3sCniStatus>(
    'bash',
    [scriptPath, 'status', '--json'],
    projectRoot,
    {
      activeCni: 'flannel-default',
      ebpfMode: false,
      ciliumInstalled: false,
      hubbleObservability: false,
      tetragonSecurity: false,
      clusterNodes: 1,
    }
  );
}

export function installK3sCni(projectRoot: string, options?: { withHubble?: boolean; withTetragon?: boolean; dryRun?: boolean }): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_cni.sh');
  const args = [scriptPath, 'install', 'cilium'];
  if (options?.withHubble) args.push('--hubble');
  if (options?.withTetragon) args.push('--tetragon');
  if (options?.dryRun) args.push('--dry-run');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sSecretsStatus {
  encryptionAtRestEnabled: boolean;
  configFile: string;
  activeProvider: string;
  keyCount: number;
  lastRotated: string;
}

export async function getK3sSecretsStatus(projectRoot: string): Promise<K3sSecretsStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_secrets_rotate.sh');
  return runSilentJsonQuery<K3sSecretsStatus>(
    'bash',
    [scriptPath, 'status', '--json'],
    projectRoot,
    {
      encryptionAtRestEnabled: false,
      configFile: '/etc/rancher/k3s/secrets-encryption.yaml',
      activeProvider: 'none',
      keyCount: 0,
      lastRotated: 'none',
    }
  );
}

export function rotateK3sSecrets(projectRoot: string, options?: { dryRun?: boolean }): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_secrets_rotate.sh');
  const args = [scriptPath, 'rotate'];
  if (options?.dryRun) args.push('--dry-run');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sSecurityScanResult {
  totalImagesScanned: number;
  vulnerabilities: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  scannedImages: Array<{
    image: string;
    status: string;
    critical: number;
    high: number;
    medium: number;
    low: number;
  }>;
}

export async function getK3sSecurityStatus(projectRoot: string): Promise<any> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_security_scan.sh');
  return runSilentJsonQuery<any>(
    'bash',
    [scriptPath, 'status', '--json'],
    projectRoot,
    { trivyInstalled: false, operatorInstalled: false, clusterAuditingReady: false }
  );
}

export function scanK3sSecurity(projectRoot: string, options?: { image?: string; namespace?: string; severity?: string }): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_security_scan.sh');
  const args = [scriptPath, 'scan'];
  if (options?.image) args.push('--image', options.image.trim());
  if (options?.namespace) args.push('--namespace', options.namespace.trim());
  if (options?.severity) args.push('--severity', options.severity.trim());
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

// ==============================================================================
// Phase 3: Distributed Storage & Snapshots
// ==============================================================================

export interface OpenEBSEngineStatus {
  hostpath: boolean;
  lvm: boolean;
  zfs: boolean;
  rawfile: boolean;
  mayastor: boolean;
  nats: boolean;
  minio: boolean;
  loki: boolean;
  alloy: boolean;
  nfs: boolean;
}

export interface HostVolumeGroup {
  vg_name: string;
  pv_count: string;
  lv_count: string;
  snap_count: string;
  vg_attr: string;
  vg_size: string;
  vg_free: string;
}

export interface OpenEBSConfig {
  vg: string;
  fsType: string;
  thinProvision: string;
  shared: string;
  storageClass: string;
  isDefaultSc: string;
}

export interface K3sStorageStatus {
  defaultStorageClass: string;
  storageClasses: string[];
  csiDrivers: string[];
  totalPVs: number;
  totalPVCs: number;
  longhornActive: boolean;
  openebsActive: boolean;
  lvmNodesRegistered?: number;
  topologyKey?: string;
  topologyNodes?: string[];
  engines?: OpenEBSEngineStatus;
  hostVolumeGroups?: HostVolumeGroup[];
  config?: OpenEBSConfig;
}

export interface OpenEBSInstallOptions {
  engine?: 'longhorn' | 'openebs';
  replicas?: number;
  vg?: string;
  fsType?: 'ext4' | 'xfs' | 'btrfs';
  thinProvision?: boolean;
  shared?: boolean;
  enableLvm?: boolean;
  enableHostpath?: boolean;
  enableZfs?: boolean;
  enableRawfile?: boolean;
  enableMayastor?: boolean;
  enableNats?: boolean;
  enableMinio?: boolean;
  enableLoki?: boolean;
  enableAlloy?: boolean;
  enableNfs?: boolean;
  setDefaultSc?: boolean;
  labelNodes?: boolean;
}

export async function getK3sStorageStatus(projectRoot: string): Promise<K3sStorageStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_storage.sh');
  return runSilentJsonQuery<K3sStorageStatus>(
    'bash',
    [scriptPath, 'status', '--json'],
    projectRoot,
    {
      defaultStorageClass: 'local-path',
      storageClasses: ['local-path'],
      csiDrivers: [],
      totalPVs: 0,
      totalPVCs: 0,
      longhornActive: false,
      openebsActive: false,
    }
  );
}

export function installK3sStorage(projectRoot: string, options?: OpenEBSInstallOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_storage.sh');
  const args = [scriptPath, 'install'];
  if (options?.engine) args.push('--engine', options.engine);
  if (options?.replicas) args.push('--replicas', String(options.replicas));
  if (options?.vg) args.push('--vg', options.vg);
  if (options?.fsType) args.push('--fstype', options.fsType);
  if (options?.thinProvision) args.push('--thin-provision');
  if (options?.shared) args.push('--shared');
  if (options?.enableLvm !== undefined) args.push('--enable-lvm', String(options.enableLvm));
  if (options?.enableHostpath !== undefined) args.push('--enable-hostpath', String(options.enableHostpath));
  if (options?.enableZfs !== undefined) args.push('--enable-zfs', String(options.enableZfs));
  if (options?.enableRawfile !== undefined) args.push('--enable-rawfile', String(options.enableRawfile));
  if (options?.enableMayastor !== undefined) args.push('--enable-mayastor', String(options.enableMayastor));
  if (options?.enableNats !== undefined) args.push('--enable-nats', String(options.enableNats));
  if (options?.enableMinio !== undefined) args.push('--enable-minio', String(options.enableMinio));
  if (options?.enableLoki !== undefined) args.push('--enable-loki', String(options.enableLoki));
  if (options?.enableAlloy !== undefined) args.push('--enable-alloy', String(options.enableAlloy));
  if (options?.enableNfs !== undefined) args.push('--enable-nfs', String(options.enableNfs));
  if (options?.setDefaultSc) args.push('--set-default-sc');
  if (options?.labelNodes) args.push('--label-nodes');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export function testK3sStorageBenchmark(projectRoot: string, storageClass: string = 'openebs-lvmpv'): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_storage.sh');
  const args = [scriptPath, 'benchmark', '--sc', storageClass];
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export function snapshotK3sVolume(projectRoot: string, pvcName: string, snapshotName?: string): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_storage.sh');
  const args = [scriptPath, 'snapshot', '--pvc', pvcName];
  if (snapshotName) args.push('--name', snapshotName);
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

// ==============================================================================
// Phase 4: Proactive Observability & Incident Response
// ==============================================================================

export interface K3sMonitoringStatus {
  namespace: string;
  victoriaMetricsActive: boolean;
  vmagentActive: boolean;
  alertmanagerActive: boolean;
  monitoringPods: number;
  alertRulesDeployed: number;
  etcdScrapeConfigured: boolean;
}

export async function getK3sMonitoringStatus(projectRoot: string): Promise<K3sMonitoringStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_monitoring.sh');
  return runSilentJsonQuery<K3sMonitoringStatus>(
    'bash',
    [scriptPath, 'status', '--json'],
    projectRoot,
    {
      namespace: 'monitoring',
      victoriaMetricsActive: false,
      vmagentActive: false,
      alertmanagerActive: false,
      monitoringPods: 0,
      alertRulesDeployed: 0,
      etcdScrapeConfigured: true,
    }
  );
}

export function installK3sMonitoring(projectRoot: string, options?: { retention?: string; namespace?: string }): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_monitoring.sh');
  const args = [scriptPath, 'install'];
  if (options?.retention) args.push('--retention', options.retention);
  if (options?.namespace) args.push('--namespace', options.namespace);
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export function dispatchAlert(
  projectRoot: string,
  options: { title: string; message: string; severity?: 'info' | 'warning' | 'critical'; source?: string }
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'alert_dispatcher.sh');
  const args = [scriptPath, 'send', '--title', options.title, '--message', options.message];
  if (options.severity) args.push('--severity', options.severity);
  if (options.source) args.push('--source', options.source);
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

// ==============================================================================
// Phase 5: GPU Acceleration & Edge AI Workload Optimization
// ==============================================================================

export interface K3sGpuStatus {
  nvidiaGpuPresent: boolean;
  gpuModel: string;
  vramMegabytes: number;
  containerToolkitInstalled: boolean;
  containerdConfigured: boolean;
  devicePluginRunning: boolean;
  allocatableGpus: number;
}

export async function getK3sGpuStatus(projectRoot: string): Promise<K3sGpuStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_gpu.sh');
  return runSilentJsonQuery<K3sGpuStatus>(
    'bash',
    [scriptPath, 'status', '--json'],
    projectRoot,
    {
      nvidiaGpuPresent: false,
      gpuModel: 'none',
      vramMegabytes: 0,
      containerToolkitInstalled: false,
      containerdConfigured: false,
      devicePluginRunning: false,
      allocatableGpus: 0,
    }
  );
}

export function setupK3sGpu(projectRoot: string, options?: { dryRun?: boolean }): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_gpu.sh');
  const args = [scriptPath, 'setup'];
  if (options?.dryRun) args.push('--dry-run');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sModelCacheStatus {
  namespace: string;
  cachePvcExists: boolean;
  pvcStatus: string;
  requestedCapacity: string;
  cachedModelsCount: number;
}

export async function getK3sModelCacheStatus(projectRoot: string): Promise<K3sModelCacheStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_model_cache.sh');
  return runSilentJsonQuery<K3sModelCacheStatus>(
    'bash',
    [scriptPath, 'status', '--json'],
    projectRoot,
    {
      namespace: 'ai',
      cachePvcExists: false,
      pvcStatus: 'NotFound',
      requestedCapacity: '0',
      cachedModelsCount: 0,
    }
  );
}

export function setupK3sModelCache(projectRoot: string, options?: { namespace?: string; size?: string; storageClass?: string }): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_model_cache.sh');
  const args = [scriptPath, 'setup'];
  if (options?.namespace) args.push('--namespace', options.namespace);
  if (options?.size) args.push('--size', options.size);
  if (options?.storageClass) args.push('--storage-class', options.storageClass);
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export function preloadK3sModel(projectRoot: string, modelName: string, namespace?: string): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_model_cache.sh');
  const args = [scriptPath, 'preload', '--model', modelName];
  if (namespace) args.push('--namespace', namespace);
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}
