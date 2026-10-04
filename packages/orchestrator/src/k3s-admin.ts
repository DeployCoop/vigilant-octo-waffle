import * as fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type ClusterHealthGrade = 'OPTIMAL' | 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'OFFLINE';

export interface K3sLiveHealthReport {
  score: number;
  grade: ClusterHealthGrade;
  apiLatencyMs: number;
  apiAlive: boolean;
  etcdQuorum: boolean;
  nodes: {
    total: number;
    ready: number;
    notReady: number;
    pressureAlerts: string[];
  };
  pods: {
    total: number;
    running: number;
    pending: number;
    failing: number;
    totalRestarts: number;
  };
  recommendations: string[];
}

export interface CisCheckResult {
  id: string;
  description: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  details: string;
  remediation?: string;
}

export interface K3sCisHardeningReport {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warnChecks: number;
  scorePercentage: number;
  findings: CisCheckResult[];
}

export interface K3sNodeDetail {
  name: string;
  roles: string[];
  status: 'Ready' | 'NotReady' | 'SchedulingDisabled' | 'Unknown';
  internalIp: string;
  kubeletVersion: string;
  osImage: string;
  cpuCapacity: string;
  memoryCapacity: string;
  podCount: number;
  conditions: Array<{ type: string; status: string; message?: string }>;
}

/**
 * Evaluates live K3s cluster health, latency, node pressures, and pod stability
 */
export async function getK3sHealthScore(projectRoot: string): Promise<K3sLiveHealthReport> {
  const report: K3sLiveHealthReport = {
    score: 0,
    grade: 'OFFLINE',
    apiLatencyMs: 0,
    apiAlive: false,
    etcdQuorum: false,
    nodes: { total: 0, ready: 0, notReady: 0, pressureAlerts: [] },
    pods: { total: 0, running: 0, pending: 0, failing: 0, totalRestarts: 0 },
    recommendations: [],
  };

  try {
    // 1. Measure API Server Latency
    const start = Date.now();
    await execAsync('kubectl get --raw /livez', { cwd: projectRoot, timeout: 5000 });
    report.apiLatencyMs = Date.now() - start;
    report.apiAlive = true;

    // 2. Control Plane / Readyz check
    try {
      const { stdout: readyzOut } = await execAsync('kubectl get --raw /readyz?verbose', { cwd: projectRoot, timeout: 5000 });
      report.etcdQuorum = readyzOut.includes('[+]etcd') || !readyzOut.includes('[-]etcd');
    } catch {
      report.etcdQuorum = true; // SQLite/Kine mode in single-node K3s
    }

    // 3. Inspect Nodes
    const { stdout: nodesOut } = await execAsync('kubectl get nodes -o json', { cwd: projectRoot });
    const nodesData = JSON.parse(nodesOut);
    report.nodes.total = (nodesData.items || []).length;

    for (const node of nodesData.items || []) {
      const nodeName = node.metadata?.name || 'unknown';
      const conds = node.status?.conditions || [];
      const readyCond = conds.find((c: any) => c.type === 'Ready');

      if (readyCond?.status === 'True') {
        report.nodes.ready++;
      } else {
        report.nodes.notReady++;
        report.recommendations.push(`Node '${nodeName}' is NotReady`);
      }

      for (const p of ['MemoryPressure', 'DiskPressure', 'PIDPressure']) {
        const cond = conds.find((c: any) => c.type === p);
        if (cond?.status === 'True') {
          report.nodes.pressureAlerts.push(`${nodeName} has ${p}`);
          report.recommendations.push(`Node '${nodeName}' has active condition '${p}'`);
        }
      }
    }

    // 4. Inspect Pods in all namespaces
    const { stdout: podsOut } = await execAsync('kubectl get pods -A -o json', { cwd: projectRoot });
    const podsData = JSON.parse(podsOut);
    report.pods.total = (podsData.items || []).length;

    for (const pod of podsData.items || []) {
      const phase = pod.status?.phase;
      const cStatuses = pod.status?.containerStatuses || [];
      const restarts = cStatuses.reduce((acc: number, c: any) => acc + (c.restartCount || 0), 0);
      report.pods.totalRestarts += restarts;

      if (phase === 'Running') {
        report.pods.running++;
      } else if (phase === 'Pending') {
        report.pods.pending++;
        const podName = pod.metadata?.name;
        const ns = pod.metadata?.namespace;
        report.recommendations.push(`Pod '${ns}/${podName}' is stuck in Pending`);
      } else if (phase === 'Failed' || phase === 'Unknown') {
        report.pods.failing++;
        const podName = pod.metadata?.name;
        const ns = pod.metadata?.namespace;
        report.recommendations.push(`Pod '${ns}/${podName}' is failing (${phase})`);
      }

      const isCrashLoop = cStatuses.some((c: any) => c.state?.waiting?.reason === 'CrashLoopBackOff');
      if (isCrashLoop) {
        report.pods.failing++;
        const podName = pod.metadata?.name;
        const ns = pod.metadata?.namespace;
        report.recommendations.push(`Pod '${ns}/${podName}' is in CrashLoopBackOff`);
      }
    }

    // 5. Calculate Score (0 - 100)
    let score = 100;

    if (!report.apiAlive) {
      score = 0;
    } else {
      // Latency penalty
      if (report.apiLatencyMs > 500) score -= 20;
      else if (report.apiLatencyMs > 200) score -= 10;
      else if (report.apiLatencyMs > 100) score -= 5;

      // Node penalty
      if (report.nodes.notReady > 0) {
        score -= (report.nodes.notReady / Math.max(1, report.nodes.total)) * 40;
      }

      // Pressure penalty
      score -= Math.min(25, report.nodes.pressureAlerts.length * 10);

      // Failing pods penalty
      score -= Math.min(25, report.pods.failing * 5);
      score -= Math.min(10, report.pods.pending * 2);
    }

    report.score = Math.max(0, Math.min(100, Math.round(score)));

    if (report.score >= 90) report.grade = 'OPTIMAL';
    else if (report.score >= 75) report.grade = 'HEALTHY';
    else if (report.score >= 50) report.grade = 'DEGRADED';
    else report.grade = 'CRITICAL';

  } catch (err: any) {
    report.recommendations.push(`Cluster unreachable: ${err.message}`);
  }

  return report;
}

/**
 * Audits cluster configuration against CIS Kubernetes Benchmark guidelines
 */
export async function runK3sCisAudit(projectRoot: string): Promise<K3sCisHardeningReport> {
  const findings: CisCheckResult[] = [];

  // Check 1: Kubeconfig permissions
  const kubeconfigPath = '/etc/rancher/k3s/k3s.yaml';
  if (fs.existsSync(kubeconfigPath)) {
    try {
      const stats = fs.statSync(kubeconfigPath);
      const mode = (stats.mode & parseInt('777', 8)).toString(8);
      if (mode === '600' || mode === '640') {
        findings.push({
          id: 'CIS-1.1.1',
          description: 'Kubeconfig file permissions',
          status: 'PASS',
          details: `Permissions are ${mode} (<= 640)`,
        });
      } else {
        findings.push({
          id: 'CIS-1.1.1',
          description: 'Kubeconfig file permissions',
          status: 'FAIL',
          details: `Permissions are ${mode} (should be 600 or 640)`,
          remediation: `chmod 600 ${kubeconfigPath}`,
        });
      }
    } catch {
      findings.push({ id: 'CIS-1.1.1', description: 'Kubeconfig file permissions', status: 'WARN', details: 'Cannot read permissions' });
    }
  } else {
    findings.push({ id: 'CIS-1.1.1', description: 'Kubeconfig file permissions', status: 'INFO', details: 'Standard k3s.yaml not found on host (running remotely or non-standard path)' });
  }

  // Check 2: Anonymous auth disabled
  try {
    const { stdout } = await execAsync('kubectl get --raw /readyz 2>&1 || true');
    if (stdout.includes('Unauthorized') || stdout.includes('anonymous')) {
      findings.push({ id: 'CIS-1.2.1', description: 'Anonymous authentication disabled', status: 'PASS', details: 'Anonymous requests rejected' });
    } else {
      findings.push({ id: 'CIS-1.2.1', description: 'Anonymous authentication disabled', status: 'WARN', details: 'Anonymous requests permitted on health endpoints (default K3s)', remediation: 'Add --kube-apiserver-arg="anonymous-auth=false" to k3s server config' });
    }
  } catch {
    findings.push({ id: 'CIS-1.2.1', description: 'Anonymous authentication disabled', status: 'INFO', details: 'Could not test raw auth endpoint' });
  }

  // Check 3: Pod Security Standards enforcement
  try {
    const { stdout } = await execAsync('kubectl get namespaces -o json', { cwd: projectRoot });
    const nsData = JSON.parse(stdout);
    const namespacesWithoutPss: string[] = [];

    for (const ns of nsData.items || []) {
      const name = ns.metadata?.name || '';
      const labels = ns.metadata?.labels || {};
      if (!labels['pod-security.kubernetes.io/enforce'] && name !== 'kube-system') {
        namespacesWithoutPss.push(name);
      }
    }

    if (namespacesWithoutPss.length === 0) {
      findings.push({ id: 'CIS-5.1.1', description: 'Pod Security Standards active on namespaces', status: 'PASS', details: 'All application namespaces have PSS labels configured' });
    } else {
      findings.push({
        id: 'CIS-5.1.1',
        description: 'Pod Security Standards active on namespaces',
        status: 'WARN',
        details: `${namespacesWithoutPss.length} namespaces missing PSS enforcement labels: ${namespacesWithoutPss.slice(0, 3).join(', ')}...`,
        remediation: 'Run: vow namespaces sync',
      });
    }
  } catch {
    findings.push({ id: 'CIS-5.1.1', description: 'Pod Security Standards active on namespaces', status: 'INFO', details: 'Cluster offline' });
  }

  // Check 4: Default ServiceAccount automount tokens
  try {
    const { stdout } = await execAsync('kubectl get sa default -n default -o json', { cwd: projectRoot });
    const sa = JSON.parse(stdout);
    if (sa.automountServiceAccountToken === false) {
      findings.push({ id: 'CIS-5.1.5', description: 'Default service account automount token disabled', status: 'PASS', details: 'automountServiceAccountToken: false' });
    } else {
      findings.push({
        id: 'CIS-5.1.5',
        description: 'Default service account automount token disabled',
        status: 'FAIL',
        details: 'Default ServiceAccount mounts token automatically',
        remediation: 'kubectl patch sa default -n default -p \'{"automountServiceAccountToken": false}\'',
      });
    }
  } catch {
    findings.push({ id: 'CIS-5.1.5', description: 'Default service account automount token disabled', status: 'INFO', details: 'Cluster offline' });
  }

  const passed = findings.filter((f) => f.status === 'PASS').length;
  const failed = findings.filter((f) => f.status === 'FAIL').length;
  const warns = findings.filter((f) => f.status === 'WARN').length;
  const total = findings.length;
  const score = total > 0 ? Math.round((passed / total) * 100) : 100;

  return {
    totalChecks: total,
    passedChecks: passed,
    failedChecks: failed,
    warnChecks: warns,
    scorePercentage: score,
    findings,
  };
}

/**
 * Lists detailed node metrics and conditions
 */
export async function getK3sNodes(projectRoot: string): Promise<K3sNodeDetail[]> {
  try {
    const { stdout } = await execAsync('kubectl get nodes -o json', { cwd: projectRoot });
    const data = JSON.parse(stdout);

    return (data.items || []).map((node: any) => {
      const name = node.metadata?.name || '';
      const labels = node.metadata?.labels || {};
      const roles = Object.keys(labels)
        .filter((k) => k.startsWith('node-role.kubernetes.io/'))
        .map((k) => k.replace('node-role.kubernetes.io/', ''));

      const conds = (node.status?.conditions || []).map((c: any) => ({
        type: c.type,
        status: c.status,
        message: c.message,
      }));

      const readyCond = conds.find((c: any) => c.type === 'Ready');
      let status: K3sNodeDetail['status'] = 'Unknown';
      if (node.spec?.unschedulable) status = 'SchedulingDisabled';
      else if (readyCond?.status === 'True') status = 'Ready';
      else status = 'NotReady';

      const addresses = node.status?.addresses || [];
      const internalIp = addresses.find((a: any) => a.type === 'InternalIP')?.address || 'unknown';

      return {
        name,
        roles: roles.length > 0 ? roles : ['worker'],
        status,
        internalIp,
        kubeletVersion: node.status?.nodeInfo?.kubeletVersion || '',
        osImage: node.status?.nodeInfo?.osImage || '',
        cpuCapacity: node.status?.capacity?.cpu || '0',
        memoryCapacity: node.status?.capacity?.memory || '0',
        podCount: 0,
        conditions: conds,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Drains a node safely for maintenance or upgrade
 */
export async function drainK3sNodeLive(
  projectRoot: string,
  nodeName: string,
  options: {
    ignoreDaemonsets?: boolean;
    force?: boolean;
    deleteEmptyDir?: boolean;
  } = {}
): Promise<{ success: boolean; output: string }> {
  const flags: string[] = [];
  if (options.ignoreDaemonsets ?? true) flags.push('--ignore-daemonsets');
  if (options.deleteEmptyDir ?? true) flags.push('--delete-emptydir-data');
  if (options.force ?? true) flags.push('--force');

  const cmd = `kubectl drain ${JSON.stringify(nodeName)} ${flags.join(' ')}`;
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: projectRoot });
    return {
      success: true,
      output: (stdout + '\n' + stderr).trim(),
    };
  } catch (err: any) {
    return {
      success: false,
      output: err.message,
    };
  }
}

/**
 * Cordons or uncordons a node
 */
export async function cordonK3sNodeLive(
  projectRoot: string,
  nodeName: string,
  uncordon = false
): Promise<{ success: boolean; message: string }> {
  const verb = uncordon ? 'uncordon' : 'cordon';
  try {
    await execAsync(`kubectl ${verb} ${JSON.stringify(nodeName)}`, { cwd: projectRoot });
    return {
      success: true,
      message: `Node '${nodeName}' ${verb}ed successfully`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to ${verb} node '${nodeName}': ${err.message}`,
    };
  }
}
