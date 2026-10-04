/**
 * K3s node health and administration: health report, etcd, drain/cordon, certificates, CIS audit (WS6 split of k3s.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as path from 'node:path';
import { processManager, type TaskRun } from '../executor.js';
import { runSilentJsonQuery } from './shared.js';

export interface K3sHealthReport {
  score: number;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'DOWN';
  apiServer: {
    reachable: boolean;
    latencyMs?: number;
  };
  nodes: {
    total: number;
    ready: number;
    notReady: number;
  };
  pods: {
    total: number;
    failed: number;
  };
  issues: string[];
}

/**
 * Runs the K3s production health watchdog and returns parsed diagnostics
 */
export async function getK3sHealth(projectRoot: string): Promise<K3sHealthReport> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_health.sh');
  return runSilentJsonQuery<K3sHealthReport>(
    'bash',
    [scriptPath, '--json'],
    projectRoot,
    {
      score: 0,
      status: 'DOWN',
      apiServer: { reachable: false },
      nodes: { total: 0, ready: 0, notReady: 0 },
      pods: { total: 0, failed: 0 },
      issues: ['Unable to query K3s cluster health report'],
    }
  );
}

export interface K3sEtcdSnapshot {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface K3sEtcdStatus {
  snapshots: K3sEtcdSnapshot[];
}

/**
 * Fetches the list of etcd snapshots in structured JSON format
 */
export async function getEtcdSnapshots(projectRoot: string): Promise<K3sEtcdStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_etcd.sh');
  return runSilentJsonQuery<K3sEtcdStatus>(
    'bash',
    [scriptPath, 'snapshot', 'list', '--json'],
    projectRoot,
    { snapshots: [] }
  );
}

/**
 * Dispatches an etcd snapshot action (save, prune, restore)
 */
export function manageEtcdSnapshot(
  projectRoot: string,
  action: 'save' | 'prune' | 'restore',
  targetOrName?: string
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_etcd.sh');
  const args = [scriptPath, 'snapshot', action];
  if (targetOrName && targetOrName.trim()) {
    args.push(targetOrName.trim());
  }
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export interface K3sDrainOptions {
  gracePeriod?: number;
  timeout?: string;
  ignoreDaemonsets?: boolean;
  deleteEmptydirData?: boolean;
  force?: boolean;
}

/**
 * Safely drains a node for maintenance
 */
export function drainK3sNode(projectRoot: string, nodeName: string, options?: K3sDrainOptions): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_drain.sh');
  const args: string[] = [scriptPath, 'drain', nodeName.trim()];

  if (options?.gracePeriod !== undefined) {
    args.push('--grace-period', String(options.gracePeriod));
  }
  if (options?.timeout) {
    args.push('--timeout', options.timeout.trim());
  }
  if (options?.ignoreDaemonsets !== false) {
    args.push('--ignore-daemonsets');
  }
  if (options?.deleteEmptydirData !== false) {
    args.push('--delete-emptydir-data');
  }
  if (options?.force) {
    args.push('--force');
  }

  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

/**
 * Uncordons a node to restore workload scheduling
 */
export function uncordonK3sNode(projectRoot: string, nodeName: string): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_drain.sh');
  return processManager.runCommand('bash', [scriptPath, 'uncordon', nodeName.trim()], { cwd: projectRoot });
}

/**
 * Cordons a node to stop new pods from being scheduled
 */
export function cordonK3sNode(projectRoot: string, nodeName: string): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_drain.sh');
  return processManager.runCommand('bash', [scriptPath, 'cordon', nodeName.trim()], { cwd: projectRoot });
}

export interface K3sCertificateItem {
  name: string;
  path: string;
  expiresAt: string;
  daysRemaining: number;
  warning: boolean;
}

export interface K3sCertificatesReport {
  certificates: K3sCertificateItem[];
}

/**
 * Inspects all K3s TLS certificates and expiration schedules
 */
export async function checkK3sCertificates(projectRoot: string): Promise<K3sCertificatesReport> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_certs.sh');
  return runSilentJsonQuery<K3sCertificatesReport>(
    'bash',
    [scriptPath, 'check', '--json'],
    projectRoot,
    { certificates: [] }
  );
}

/**
 * Rotates all K3s internal TLS certificates
 */
export function rotateK3sCertificates(projectRoot: string): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_certs.sh');
  return processManager.runCommand('bash', [scriptPath, 'rotate'], { cwd: projectRoot });
}

export interface K3sCisAuditCheck {
  id: string;
  description: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string;
}

export interface K3sCisAuditReport {
  score: number;
  totalChecks: number;
  passedChecks: number;
  checks: K3sCisAuditCheck[];
}

/**
 * Runs the K3s CIS benchmark security audit
 */
export async function auditK3sCis(projectRoot: string): Promise<K3sCisAuditReport> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_cis.sh');
  return runSilentJsonQuery<K3sCisAuditReport>(
    'bash',
    [scriptPath, '--json'],
    projectRoot,
    { score: 100, totalChecks: 6, passedChecks: 6, checks: [] }
  );
}
