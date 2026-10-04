/**
 * K3s cluster lifecycle: build, up, upgrade, kill, registries, node tuning (WS6 split of k3s.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as path from 'node:path';
import { processManager, type TaskRun } from '../executor.js';

export interface K3sTuneOptions {
  remoteHost?: string;
  targetsFile?: string;
  sshPort?: number;
  sshKey?: string;
}

/**
 * Tunes node OS limits (nofile, inotify, sysctl)
 */
export function tuneK3sNode(projectRoot: string, options?: K3sTuneOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_tune.sh');
  const args: string[] = [scriptPath];

  if (options?.remoteHost) {
    args.push('--remote', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sKmodOptions {
  remoteHost?: string;
  targetsFile?: string;
  sshPort?: number;
  sshKey?: string;
  modules?: string[];
}

/**
 * Provisions required kernel modules (nvme_tcp, nvme_fabrics, etc.)
 */
export function kmodK3sNode(projectRoot: string, options?: K3sKmodOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_kmod.sh');
  const args: string[] = [scriptPath];

  if (options?.remoteHost) {
    args.push('--remote', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }
  if (options?.modules && options.modules.length > 0) {
    args.push(...options.modules);
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sPingOptions {
  targetsFile?: string;
  remoteHost?: string;
  sshPort?: number;
  sshKey?: string;
  parallel?: number;
}

/**
 * Pings cluster nodes over SSH to check hostname, uptime, and network health
 */
export function pingK3sNodes(projectRoot: string, options?: K3sPingOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_ping.sh');
  const args: string[] = [scriptPath];

  if (options?.remoteHost) {
    args.push('--ssh', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }
  if (options?.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sKillOptions {
  local?: boolean;
  all?: boolean;
  remoteHost?: string;
  targetsFile?: string;
  parallel?: number;
  sshPort?: number;
  sshKey?: string;
  dryRun?: boolean;
}

/**
 * Tears down and uninstalls K3s cluster nodes
 */
export function killK3sCluster(projectRoot: string, options?: K3sKillOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_kill.sh');
  const args: string[] = [scriptPath, '-y'];

  if (options?.dryRun) {
    args.push('--dry-run');
  }
  if (options?.all) {
    args.push('--all');
  } else if (options?.local) {
    args.push('--local');
  }
  if (options?.remoteHost) {
    args.push('--remote', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }
  if (options?.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sBuildOptions {
  dryRun?: boolean;
  rebuild?: boolean;
  targetsFile?: string;
  parallel?: number;
  skipJoin?: boolean;
  skipTune?: boolean;
  skipUp?: boolean;
  registriesFile?: string;
}

/**
 * Builds or rebuilds an entire K3s cluster end-to-end
 */
export function buildK3sCluster(projectRoot: string, options?: K3sBuildOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_build.sh');
  const args: string[] = [scriptPath, '-y'];

  if (options?.dryRun) {
    args.push('--dry-run');
  }
  if (options?.rebuild) {
    args.push('--rebuild');
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }
  if (options?.skipJoin) {
    args.push('--skip-join');
  }
  if (options?.skipTune) {
    args.push('--skip-tune');
  }
  if (options?.skipUp) {
    args.push('--skip-up');
  }
  if (options?.registriesFile) {
    args.push('--registries-file', options.registriesFile.trim());
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sRegistriesOptions {
  remoteHost?: string;
  targetsFile?: string;
  registriesFile?: string;
  copyKubeconfig?: boolean;
  sshPort?: number;
  sshKey?: string;
}

/**
 * Deploys container registry mirrors and auth configuration
 */
export function deployK3sRegistries(projectRoot: string, options?: K3sRegistriesOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_registries.sh');
  const args: string[] = [scriptPath];

  if (options?.remoteHost) {
    args.push('--remote', options.remoteHost.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.registriesFile) {
    args.push('--file', options.registriesFile.trim());
  }
  if (options?.copyKubeconfig) {
    args.push('--copy-kubeconfig');
  }
  if (options?.sshPort) {
    args.push('--ssh-port', String(options.sshPort));
  }
  if (options?.sshKey) {
    args.push('--ssh-key', options.sshKey.trim());
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sUpOptions {
  targetsFile?: string;
  parallel?: number;
  skipJoin?: boolean;
  skipTune?: boolean;
  runPlatformUp?: boolean;
  registriesFile?: string;
  dryRun?: boolean;
}

/**
 * Canonical bring-up for a tuned K3s cluster with multi-node batch provisioning
 */
export function upK3sCluster(projectRoot: string, options?: K3sUpOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_up.sh');
  const args: string[] = [scriptPath];

  if (options?.dryRun) {
    args.push('--dry-run');
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.parallel && options.parallel > 1) {
    args.push('-j', String(options.parallel));
  }
  if (options?.skipJoin) {
    args.push('--skip-join');
  }
  if (options?.skipTune) {
    args.push('--skip-tune');
  }
  if (options?.runPlatformUp) {
    args.push('--run-platform-up');
  }
  if (options?.registriesFile) {
    args.push('--registries-file', options.registriesFile.trim());
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sUpgradeOptions {
  targetVersion?: string;
  targetsFile?: string;
  skipSnapshot?: boolean;
  dryRun?: boolean;
}

/**
 * Triggers zero-downtime rolling upgrade across cluster
 */
export function upgradeK3sCluster(projectRoot: string, options?: K3sUpgradeOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_upgrade.sh');
  const args: string[] = [scriptPath];

  if (options?.targetVersion) {
    args.push(options.targetVersion.trim());
  }
  if (options?.targetsFile) {
    args.push('--targets', options.targetsFile.trim());
  }
  if (options?.skipSnapshot) {
    args.push('--skip-snapshot');
  }
  if (options?.dryRun) {
    args.push('--dry-run');
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}
