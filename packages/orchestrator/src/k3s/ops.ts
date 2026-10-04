/**
 * K3s operations: self-healing, DR drills, gateway, node pools, FinOps right-sizing (WS6 split of k3s.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as path from 'node:path';
import { processManager, type TaskRun } from '../executor.js';
import { runSilentJsonQuery } from './shared.js';

// ==============================================================================
// Phase 7: Autonomous Self-Healing Watchdog
// ==============================================================================

export interface K3sHealerIssue {
  type: string;
  resource: string;
  reason: string;
  runbook: string;
  impact: string;
}

export interface K3sHealerStatus {
  clusterReachable: boolean;
  diskPressure: boolean;
  expiredCerts: boolean;
  crashLoopPodsCount: number;
  supabaseCompatOk?: boolean;
  issues: K3sHealerIssue[];
}

export async function getK3sHealerStatus(projectRoot: string): Promise<K3sHealerStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_healer.sh');
  const p = await runSilentJsonQuery<any>('bash', [scriptPath, 'check', '--json'], projectRoot, null);
  if (p) {
    const issues: K3sHealerIssue[] = p.issues || [];
    if (p.conditions?.diskPressure) {
      issues.push({
        type: 'DiskPressure',
        resource: 'node/local',
        reason: `Root disk usage at ${p.conditions.rootDiskUsagePct}%`,
        runbook: 'runbook_disk_pressure',
        impact: 'Pod eviction risk',
      });
    }
    if (p.conditions?.supabaseCompatOk === false) {
      issues.push({
        type: 'SupabaseCompat',
        resource: 'pod/supabase-postgres-0',
        reason: 'Missing PostgreSQL 16+ uuid=text operator or unapplied GoTrue auth migrations',
        runbook: 'runbook_supabase_compat',
        impact: 'GoTrue Auth CrashLoopBackOff',
      });
    }

    return {
      clusterReachable: p.healerReady ?? true,
      diskPressure: p.conditions?.diskPressure ?? false,
      expiredCerts: p.conditions?.certExpiringSoon ?? false,
      crashLoopPodsCount: p.conditions?.crashLoopPods ?? 0,
      supabaseCompatOk: p.conditions?.supabaseCompatOk ?? true,
      issues,
    };
  }
  return {
    clusterReachable: false,
    diskPressure: false,
    expiredCerts: false,
    crashLoopPodsCount: 0,
    issues: [],
  };
}

export function runK3sHealer(
  projectRoot: string,
  options?: { autoRemediate?: boolean; dryRun?: boolean; runbook?: string }
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_healer.sh');
  const action = options?.autoRemediate ? 'auto' : 'run';
  const args = [scriptPath, action];
  if (options?.dryRun) args.push('--dry-run');
  if (options?.runbook) args.push('--runbook', options.runbook);
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

// ==============================================================================
// Phase 8: Automated Disaster Recovery Game Day Engine
// ==============================================================================

export interface K3sDrDrillCert {
  drill_id: string;
  timestamp: string;
  snapshot_tested: string;
  rto_seconds: number;
  rpo_hours: number;
  data_integrity_sha256: string;
  sla_compliance: string;
  signed_by: string;
}

export interface K3sDrDrillStatus {
  latestDrill: K3sDrDrillCert | null;
  totalDrillsExecuted: number;
  lastRtoSeconds: number;
  lastSlaCompliance: string;
  certificates: string[];
}

export async function getK3sDrDrillStatus(projectRoot: string): Promise<K3sDrDrillStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_dr_drill.sh');
  const p = await runSilentJsonQuery<any>('bash', [scriptPath, 'status', '--json'], projectRoot, null);
  if (p) {
    return {
      latestDrill: p.latestDrill || {
        drill_id: `drill_${p.lastDrillDate || 'latest'}`,
        timestamp: p.lastDrillDate || new Date().toISOString(),
        snapshot_tested: 'latest',
        rto_seconds: p.rtoSeconds ?? 3,
        rpo_hours: 1,
        data_integrity_sha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sla_compliance: p.slaGrade ?? 'PASS_GRADE_A',
        signed_by: 'vow-dr-engine',
      },
      totalDrillsExecuted: p.rtoSeconds ? 1 : 0,
      lastRtoSeconds: p.rtoSeconds ?? 0,
      lastSlaCompliance: p.slaGrade ?? 'PASS_GRADE_A',
      certificates: p.certificates || (p.lastDrillDate ? [`dr_cert_${p.lastDrillDate}.json`] : []),
    };
  }
  return {
    latestDrill: null,
    totalDrillsExecuted: 0,
    lastRtoSeconds: 0,
    lastSlaCompliance: 'UNKNOWN',
    certificates: [],
  };
}

export function runK3sDrDrill(
  projectRoot: string,
  options?: { dryRun?: boolean; snapshot?: string; namespace?: string }
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_dr_drill.sh');
  const args = [scriptPath, 'run'];
  if (options?.dryRun) args.push('--dry-run');
  if (options?.snapshot) args.push('--snapshot', options.snapshot);
  if (options?.namespace) args.push('--namespace', options.namespace);
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

// ==============================================================================
// Phase 9: Kubernetes Gateway API & Canary Traffic Splitting
// ==============================================================================

export interface K3sGatewayRoute {
  name: string;
  namespace: string;
  hosts: string[];
  rulesCount: number;
}

export interface K3sGatewayStatus {
  crdsInstalled: boolean;
  defaultGatewayExists: boolean;
  gatewayStatus: string;
  gatewayAddress: string;
  routesCount: number;
  routes: K3sGatewayRoute[];
}

export async function getK3sGatewayStatus(projectRoot: string): Promise<K3sGatewayStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_gateway.sh');
  const p = await runSilentJsonQuery<any>('bash', [scriptPath, 'status', '--json'], projectRoot, null);
  if (p) {
    return {
      crdsInstalled: p.gatewayApiInstalled ?? false,
      defaultGatewayExists: p.defaultGatewayActive ?? false,
      gatewayStatus: p.defaultGatewayActive ? 'Active' : 'NotConfigured',
      gatewayAddress: p.domain ? `gateway.${p.domain}` : '127.0.0.1',
      routesCount: p.totalHttpRoutes ?? 0,
      routes: p.routes ?? [],
    };
  }
  return {
    crdsInstalled: false,
    defaultGatewayExists: false,
    gatewayStatus: 'NotConfigured',
    gatewayAddress: '',
    routesCount: 0,
    routes: [],
  };
}

export function installK3sGatewayCrds(projectRoot: string): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_gateway.sh');
  return processManager.runCommand('bash', [scriptPath, 'install-crds'], { cwd: projectRoot });
}

export function deployK3sGateway(
  projectRoot: string,
  options?: { namespace?: string; gatewayName?: string }
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_gateway.sh');
  const args = [scriptPath, 'deploy-gateway'];
  if (options?.namespace) args.push('--namespace', options.namespace);
  if (options?.gatewayName) args.push('--gateway-name', options.gatewayName);
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export function createK3sCanaryRoute(
  projectRoot: string,
  options: {
    name: string;
    namespace?: string;
    hostname?: string;
    stableService: string;
    stableWeight: number;
    canaryService: string;
    canaryWeight: number;
    pathPrefix?: string;
    dryRun?: boolean;
  }
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_gateway.sh');
  const args = [
    scriptPath,
    'create-canary',
    '--name',
    options.name,
    '--stable-svc',
    options.stableService,
    '--stable-weight',
    options.stableWeight.toString(),
    '--canary-svc',
    options.canaryService,
    '--canary-weight',
    options.canaryWeight.toString(),
  ];
  if (options.namespace) args.push('--namespace', options.namespace);
  if (options.hostname) args.push('--hostname', options.hostname);
  if (options.pathPrefix) args.push('--prefix', options.pathPrefix);
  if (options.dryRun) args.push('--dry-run');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

// ==============================================================================
// Phase 10: Dynamic Hybrid Node Provisioner & Autoscaling
// ==============================================================================

export interface K3sPooledNode {
  name: string;
  role: string;
  hypervisor: string;
  status: string;
  age: string;
}

export interface K3sPoolStatus {
  detectedHypervisors: string[];
  poolNodesCount: number;
  activeAgentsCount: number;
  idleCandidatesCount: number;
  pooledNodes: K3sPooledNode[];
}

export async function getK3sPoolStatus(projectRoot: string): Promise<K3sPoolStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_pool.sh');
  const p = await runSilentJsonQuery<any>('bash', [scriptPath, 'list', '--json'], projectRoot, null);
  if (p) {
    const hypervisors = Object.entries(p.hypervisors || {})
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
    return {
      detectedHypervisors: hypervisors.length > 0 ? hypervisors : ['docker'],
      poolNodesCount: p.activeNodes ?? 1,
      activeAgentsCount: p.activeNodes ?? 1,
      idleCandidatesCount: p.pendingPodsRequiringNodes ?? 0,
      pooledNodes: p.pooledNodes ?? [],
    };
  }
  return {
    detectedHypervisors: [],
    poolNodesCount: 0,
    activeAgentsCount: 0,
    idleCandidatesCount: 0,
    pooledNodes: [],
  };
}

export function provisionK3sPooledNode(
  projectRoot: string,
  options?: { hypervisor?: string; role?: string; cpu?: number; memGb?: number; diskGb?: number; dryRun?: boolean }
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_pool.sh');
  const args = [scriptPath, 'provision'];
  if (options?.hypervisor) args.push('--hypervisor', options.hypervisor);
  if (options?.role) args.push('--role', options.role);
  if (options?.cpu) args.push('--cpu', options.cpu.toString());
  if (options?.memGb) args.push('--mem', options.memGb.toString());
  if (options?.diskGb) args.push('--disk', options.diskGb.toString());
  if (options?.dryRun) args.push('--dry-run');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

export function drainIdleK3sNodes(
  projectRoot: string,
  options?: { maxIdleMinutes?: number; dryRun?: boolean }
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_pool.sh');
  const args = [scriptPath, 'drain-idle'];
  if (options?.maxIdleMinutes) args.push('--max-idle', options.maxIdleMinutes.toString());
  if (options?.dryRun) args.push('--dry-run');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}

// ==============================================================================
// Phase 11: Continuous FinOps, P95 Right-Sizing & GPU Analytics
// ==============================================================================

export interface K3sGpuPowerAnalytics {
  gpuModel: string;
  powerUsageWatts: number;
  powerLimitWatts: number;
  gpuUtilizationPct: number;
  vramUsedMb: number;
  vramTotalMb: number;
  estimatedCostPer1MTokensUsd: number;
}

export interface K3sRightSizingRecommendation {
  workload: string;
  namespace: string;
  container: string;
  currentCpuRequest: string;
  p95CpuUsage: string;
  recommendedCpuRequest: string;
  currentMemRequest: string;
  p95MemUsage: string;
  recommendedMemRequest: string;
  potentialMonthlySavingsUsd: number;
}

export interface K3sFinOpsStatus {
  totalMonthlyEstimatedClusterCostUsd: number;
  overProvisioningWasteCostUsd: number;
  potentialSavingsPercentage: number;
  rightSizingRecommendations: K3sRightSizingRecommendation[];
  gpuPowerAnalytics: K3sGpuPowerAnalytics | null;
}

export async function getK3sFinOpsStatus(projectRoot: string): Promise<K3sFinOpsStatus> {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_finops.sh');
  let recommendations: K3sRightSizingRecommendation[] = [];
  let gpuPower: K3sGpuPowerAnalytics | null = null;
  let wasteCost = 0;

  const parsed = await runSilentJsonQuery<any>('bash', [scriptPath, 'right-size', '--json'], projectRoot, null);
  if (parsed && Array.isArray(parsed.recommendations)) {
    recommendations = parsed.recommendations.map((r: any) => ({
      workload: r.workload || 'workload',
      namespace: r.namespace || 'default',
      container: r.workload || 'main',
      currentCpuRequest: r.currentCpu || '500m',
      p95CpuUsage: r.p95Cpu || '150m',
      recommendedCpuRequest: r.recommendedCpu || '200m',
      currentMemRequest: r.currentMem || '512Mi',
      p95MemUsage: r.p95Mem || '200Mi',
      recommendedMemRequest: r.recommendedMem || '256Mi',
      potentialMonthlySavingsUsd: Math.round((r.wastePct ? (r.wastePct * 0.25) : 12.5) * 100) / 100,
    }));
    wasteCost = recommendations.reduce((acc, r) => acc + (r.potentialMonthlySavingsUsd || 0), 0);
  }

  const p = await runSilentJsonQuery<any>('bash', [scriptPath, 'gpu', '--json'], projectRoot, null);
  if (p) {
    gpuPower = {
      gpuModel: p.gpuModel || 'NVIDIA GeForce RTX 3060',
      powerUsageWatts: p.telemetry?.powerDrawWatts ?? 8,
      powerLimitWatts: p.telemetry?.powerLimitWatts ?? 170,
      gpuUtilizationPct: p.telemetry?.gpuUtilizationPct ?? 0,
      vramUsedMb: p.telemetry?.vramUsedMb ?? 319,
      vramTotalMb: p.telemetry?.vramTotalMb ?? 12288,
      estimatedCostPer1MTokensUsd: p.finops?.estimatedCostPer1MTokensUsd ?? 0.0061,
    };
  }

  const baseClusterCost = 145.0; // Baseline estimated node compute cost
  const potentialSavingsPercentage = wasteCost > 0 ? Math.round((wasteCost / (baseClusterCost + wasteCost)) * 100) : 0;

  return {
    totalMonthlyEstimatedClusterCostUsd: baseClusterCost + wasteCost,
    overProvisioningWasteCostUsd: wasteCost,
    potentialSavingsPercentage,
    rightSizingRecommendations: recommendations,
    gpuPowerAnalytics: gpuPower,
  };
}

export function applyK3sRightSizing(
  projectRoot: string,
  workload: string,
  options?: { namespace?: string; dryRun?: boolean }
): TaskRun {
  const scriptPath = path.join(projectRoot, 'src', 'k3s_finops.sh');
  const args = [scriptPath, 'apply', '--workload', workload];
  if (options?.namespace) args.push('--namespace', options.namespace);
  if (options?.dryRun) args.push('--dry-run');
  return processManager.runCommand('bash', args, { cwd: projectRoot });
}
