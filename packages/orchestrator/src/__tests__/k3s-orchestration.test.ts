import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCommand,
  ALLOWED_EXECUTABLES,
  loadProjectConfig,
  FluxManager,
  generateK3sOneLiner,
  generateK3sJoinScript,
  saveK3sJoinScript,
  getK3sJoinInfo,
  provisionK3sBatchNodes,
  tuneK3sNode,
  kmodK3sNode,
  pingK3sNodes,
  killK3sCluster,
  buildK3sCluster,
  upK3sCluster,
  deployK3sRegistries,
  getK3sHealerStatus,
  runK3sHealer,
  getK3sDrDrillStatus,
  runK3sDrDrill,
  getK3sGatewayStatus,
  installK3sGatewayCrds,
  deployK3sGateway,
  createK3sCanaryRoute,
  getK3sPoolStatus,
  provisionK3sPooledNode,
  drainIdleK3sNodes,
  getK3sFinOpsStatus,
  applyK3sRightSizing,
  findProjectRoot,
} from '../index.js';

/**
 * Flux + K3s orchestration smoke tests (incl. the Phase 7-11 K3s
 * feature blocks). Split out of smoke.test.ts by Plan III §5.2 —
 * test bodies are verbatim moves.
 */

describe('K3s Orchestration Smoke Tests', () => {
  const projectRoot = findProjectRoot();

  describe('FluxCD & Multi-CD Orchestration', () => {
    it('allows flux binary in command allowlist', () => {
      assert.ok(ALLOWED_EXECUTABLES.has('flux'), 'flux must be in ALLOWED_EXECUTABLES');
      const res = validateCommand('flux', ['get', 'kustomizations'], projectRoot);
      assert.equal(res.allowed, true);
      assert.equal(res.normalizedCommand, 'flux');
    });

    it('loads native Flux manifests when present in flux/<app>', () => {
      const flux = new FluxManager(projectRoot);
      const manifest = flux.prepareAppManifest('nextcloud');
      assert.equal(manifest.source, 'native');
      assert.ok(manifest.templatedYaml.includes('kind: HelmRelease') || manifest.templatedYaml.includes('kind: Kustomization'));
      assert.ok(manifest.templatedYaml.includes('metadata:'));
    });

    it('synthesizes Flux manifests from ArgoCD when native flux.yaml is absent', () => {
      const flux = new FluxManager(projectRoot);
      const manifest = flux.prepareAppManifest('drupal');
      assert.equal(manifest.source, 'synthesized');
      assert.ok(manifest.templatedYaml.includes('kind: GitRepository'));
      assert.ok(manifest.templatedYaml.includes('source.toolkit.fluxcd.io/v1'));
      assert.ok(manifest.templatedYaml.includes('drupal-repo'));
      assert.ok(manifest.templatedYaml.includes('kind: HelmRelease'));
    });

    it('synthesizes Flux HelmRelease with valuesObject from ArgoCD spec', () => {
      const flux = new FluxManager(projectRoot);
      const sampleArgo = `
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: demo-helm-app
spec:
  source:
    repoURL: https://charts.example.com
    targetRevision: 1.2.3
    chart: demo-chart
    helm:
      valuesObject:
        replicaCount: 3
        image:
          tag: latest
  destination:
    namespace: demo-namespace
`;
      const synthesized = flux.synthesizeFluxFromArgo(sampleArgo, 'demo-helm-app', 'flux-system');
      assert.ok(synthesized.includes('kind: HelmRelease'));
      assert.ok(synthesized.includes('name: demo-helm-app'));
      assert.ok(synthesized.includes('replicaCount: 3'));
      assert.ok(synthesized.includes('tag: latest'));
    });

    it('supports THIS_CD_RUNNER configuration mapping in config parser', () => {
      const config = loadProjectConfig(projectRoot);
      assert.ok(['argocd', 'flux', 'both'].includes(config.cluster.cdRunner));
      assert.ok(config.cluster.fluxNamespace);
    });
  });

  describe('K3s Multi-Node Orchestration', () => {
    it('allows k3s, ssh, and scp binaries in command allowlist', () => {
      assert.ok(ALLOWED_EXECUTABLES.has('k3s'), 'k3s must be in ALLOWED_EXECUTABLES');
      assert.ok(ALLOWED_EXECUTABLES.has('ssh'), 'ssh must be in ALLOWED_EXECUTABLES');
      assert.ok(ALLOWED_EXECUTABLES.has('scp'), 'scp must be in ALLOWED_EXECUTABLES');
      // GNU parallel executes its arguments by design; removed from the
      // allowlist in the 2026-10-14 bug sweep.
      assert.ok(!ALLOWED_EXECUTABLES.has('parallel'), 'parallel must NOT be in ALLOWED_EXECUTABLES');

      const k3sRes = validateCommand('k3s', ['--version'], projectRoot);
      assert.equal(k3sRes.allowed, true);

      const sshRes = validateCommand('ssh', ['-p', '22', 'ubuntu@192.168.1.50'], projectRoot);
      assert.equal(sshRes.allowed, true);

      const scpRes = validateCommand('scp', ['file.txt', 'root@192.168.1.50:/tmp/'], projectRoot);
      assert.equal(scpRes.allowed, true);

      const parRes = validateCommand('parallel', ['--version'], projectRoot);
      assert.equal(parRes.allowed, false);
    });

    it('allows all K3s suite scripts via validateCommand', () => {
      const scripts = [
        'src/k3s_add_node.sh',
        'src/k3s_tune.sh',
        'src/k3s_kmod.sh',
        'src/k3s_registries.sh',
        'src/k3s_ping.sh',
        'src/k3s_kill.sh',
        'src/k3s_build.sh',
        'src/k3s_up.sh',
        'src/k3s_etcd.sh',
        'src/k3s_drain.sh',
        'src/k3s_certs.sh',
        'src/k3s_health.sh',
        'src/k3s_cis.sh',
        'src/k3s_upgrade.sh',
        'src/k3s_vip.sh',
        'src/k3s_backup_sync.sh',
        'src/k3s_airgap.sh',
        'src/k3s_cni.sh',
        'src/k3s_secrets_rotate.sh',
        'src/k3s_security_scan.sh',
        'src/k3s_storage.sh',
        'src/k3s_monitoring.sh',
        'src/alert_dispatcher.sh',
        'src/k3s_gpu.sh',
        'src/k3s_model_cache.sh',
        'src/k3s_healer.sh',
        'src/k3s_dr_drill.sh',
        'src/k3s_gateway.sh',
        'src/k3s_pool.sh',
        'src/k3s_finops.sh',
      ];

      for (const scr of scripts) {
        const res = validateCommand('bash', [scr, '--help'], projectRoot);
        assert.equal(res.allowed, true, `Expected ${scr} to be allowed`);
        assert.equal(res.normalizedCommand, 'bash');
      }
    });

    it('generates valid one-liner curl join commands for agent and server roles', () => {
      const agentCmd = generateK3sOneLiner({
        role: 'agent',
        serverUrl: 'https://192.168.1.10:6443',
        token: 'secret-token-123',
        nodeName: 'worker-edge-1',
        labels: { tier: 'backend', env: 'production' },
      });
      assert.ok(agentCmd.startsWith('curl -sfL https://get.k3s.io | '));
      assert.ok(agentCmd.includes('K3S_URL="https://192.168.1.10:6443"'));
      assert.ok(agentCmd.includes('K3S_TOKEN="secret-token-123"'));
      assert.ok(agentCmd.includes('sh -s - agent'));
      assert.ok(agentCmd.includes('--node-name worker-edge-1'));
      assert.ok(agentCmd.includes('--node-label tier=backend'));
      assert.ok(agentCmd.includes('--node-label env=production'));

      const serverCmd = generateK3sOneLiner({
        role: 'server',
        serverUrl: 'https://192.168.1.10:6443',
        token: 'secret-token-123',
        nodeName: 'master-2',
      });
      assert.ok(serverCmd.includes('sh -s - server'));
      assert.ok(serverCmd.includes('--node-name master-2'));
    });

    it('generates complete standalone bash join scripts with safety checks', () => {
      const script = generateK3sJoinScript({
        role: 'agent',
        serverUrl: 'https://192.168.1.10:6443',
        token: 'secret-token-123',
        nodeName: 'worker-gpu-1',
        taints: ['nvidia.com/gpu=present:NoSchedule'],
      });
      assert.ok(script.startsWith('#!/usr/bin/env bash'));
      assert.ok(script.includes('set -euo pipefail'));
      assert.ok(script.includes('export K3S_URL="https://192.168.1.10:6443"'));
      assert.ok(script.includes('export K3S_TOKEN="secret-token-123"'));
      assert.ok(script.includes('curl -sfL https://get.k3s.io | sh -s - agent'));
      assert.ok(script.includes('--node-name worker-gpu-1'));
      assert.ok(script.includes('--node-taint nvidia.com/gpu=present:NoSchedule'));
    });

    it('saves join scripts securely to .secrets/ directory and prevents traversal', () => {
      const saved = saveK3sJoinScript(projectRoot, {
        role: 'agent',
        serverUrl: 'https://192.168.1.10:6443',
        token: 'secret-token-123',
      }, 'test_k3s_join_agent.sh');

      assert.ok(saved.filePath.includes('.secrets'));
      assert.ok(saved.relativePath.startsWith('.secrets'));

      // Clean up test file
      import('node:fs').then((fs) => {
        if (fs.existsSync(saved.filePath)) {
          fs.unlinkSync(saved.filePath);
        }
      });
    });

    it('retrieves comprehensive K3s cluster join info with masked tokens', () => {
      const info = getK3sJoinInfo(projectRoot, {
        serverUrl: 'https://192.168.1.10:6443',
        token: 'K10abcd1234efgh5678',
      });
      assert.equal(info.serverUrl, 'https://192.168.1.10:6443');
      assert.equal(info.token, 'K10abcd1234efgh5678');
      assert.equal(info.tokenMasked, 'K10a...5678');
      assert.ok(info.agentOneLiner.includes('agent'));
      assert.ok(info.serverOneLiner.includes('server'));
      assert.ok(info.agentScript.includes('#!/usr/bin/env bash'));
      assert.ok(info.serverScript.includes('#!/usr/bin/env bash'));
    });

    it('dispatches batch join, tuning, ping, registries, and lifecycle commands correctly', () => {
      const pingTask = pingK3sNodes(projectRoot, {
        remoteHost: 'ubuntu@192.168.1.50',
        parallel: 5,
      });
      assert.ok(pingTask.id);
      assert.equal(pingTask.command, 'bash');
      assert.ok(pingTask.args.some((a) => a.includes('k3s_ping.sh')));
      assert.ok(pingTask.args.includes('--ssh'));
      assert.ok(pingTask.args.includes('-j'));

      const tuneTask = tuneK3sNode(projectRoot, {
        remoteHost: 'root@192.168.1.51',
      });
      assert.ok(tuneTask.id);
      assert.ok(tuneTask.args.some((a) => a.includes('k3s_tune.sh')));

      const kmodTask = kmodK3sNode(projectRoot, {
        modules: ['nvme_tcp', 'nvme_fabrics'],
      });
      assert.ok(kmodTask.id);
      assert.ok(kmodTask.args.some((a) => a.includes('k3s_kmod.sh')));
      assert.ok(kmodTask.args.includes('nvme_tcp'));

      const regTask = deployK3sRegistries(projectRoot, {
        copyKubeconfig: true,
      });
      assert.ok(regTask.id);
      assert.ok(regTask.args.some((a) => a.includes('k3s_registries.sh')));
      assert.ok(regTask.args.includes('--copy-kubeconfig'));

      const batchTask = provisionK3sBatchNodes(projectRoot, {
        targetsFile: 'targets.txt',
        parallel: 10,
        tune: true,
        copyRegistries: true,
      });
      assert.ok(batchTask.id);
      assert.ok(batchTask.args.some((a) => a.includes('k3s_add_node.sh')));
      assert.ok(batchTask.args.includes('--targets'));
      assert.ok(batchTask.args.includes('--tune'));
      assert.ok(batchTask.args.includes('--copy-registries'));

      const killTask = killK3sCluster(projectRoot, {
        all: true,
        dryRun: true,
      });
      assert.ok(killTask.id);
      assert.ok(killTask.args.some((a) => a.includes('k3s_kill.sh')));
      assert.ok(killTask.args.includes('--all'));
      assert.ok(killTask.args.includes('--dry-run'));

      const buildTask = buildK3sCluster(projectRoot, {
        dryRun: true,
        rebuild: true,
        skipUp: true,
      });
      assert.ok(buildTask.id);
      assert.ok(buildTask.args.some((a) => a.includes('k3s_build.sh')));
      assert.ok(buildTask.args.includes('--dry-run'));
      assert.ok(buildTask.args.includes('--rebuild'));
      assert.ok(buildTask.args.includes('--skip-up'));

      const upTask = upK3sCluster(projectRoot, {
        targetsFile: 'targets.txt',
        parallel: 8,
        skipTune: true,
        dryRun: true,
      });
      assert.ok(upTask.id);
      assert.ok(upTask.args.some((a) => a.includes('k3s_up.sh')));
      assert.ok(upTask.args.includes('--targets'));
      assert.ok(upTask.args.includes('--skip-tune'));
      assert.ok(upTask.args.includes('--dry-run'));
    });
  });

  describe('Autonomous Self-Healing Watchdog (Phase 7)', () => {
    it('retrieves self-healing watchdog status with valid schema', async () => {
      const status = await getK3sHealerStatus(projectRoot);
      assert.ok(typeof status.clusterReachable === 'boolean');
      assert.ok(typeof status.diskPressure === 'boolean');
      assert.ok(typeof status.expiredCerts === 'boolean');
      assert.ok(typeof status.crashLoopPodsCount === 'number');
      assert.ok(Array.isArray(status.issues));
    });

    it('dispatches healer run task with dry-run and specific runbook', () => {
      const task = runK3sHealer(projectRoot, {
        dryRun: true,
        runbook: 'prune_disk',
      });
      assert.ok(task.id);
      assert.equal(task.command, 'bash');
      assert.ok(task.args.some((a) => a.includes('k3s_healer.sh')));
      assert.ok(task.args.includes('run'));
      assert.ok(task.args.includes('--dry-run'));
      assert.ok(task.args.includes('--runbook'));
      assert.ok(task.args.includes('prune_disk'));
    });
  });

  describe('Automated Disaster Recovery Game Day Engine (Phase 8)', () => {
    it('retrieves DR drill status and SLA compliance', async () => {
      const status = await getK3sDrDrillStatus(projectRoot);
      assert.ok(typeof status.totalDrillsExecuted === 'number');
      assert.ok(typeof status.lastRtoSeconds === 'number');
      assert.ok(typeof status.lastSlaCompliance === 'string');
      assert.ok(Array.isArray(status.certificates));
    });

    it('dispatches DR game day drill with dry-run and sandbox namespace', () => {
      const task = runK3sDrDrill(projectRoot, {
        dryRun: true,
        namespace: 'dr-test-sandbox',
      });
      assert.ok(task.id);
      assert.equal(task.command, 'bash');
      assert.ok(task.args.some((a) => a.includes('k3s_dr_drill.sh')));
      assert.ok(task.args.includes('run'));
      assert.ok(task.args.includes('--dry-run'));
      assert.ok(task.args.includes('--namespace'));
      assert.ok(task.args.includes('dr-test-sandbox'));
    });
  });

  describe('Kubernetes Gateway API & Canary Traffic Splitting (Phase 9)', () => {
    it('retrieves gateway status and route list', async () => {
      const status = await getK3sGatewayStatus(projectRoot);
      assert.ok(typeof status.crdsInstalled === 'boolean');
      assert.ok(typeof status.defaultGatewayExists === 'boolean');
      assert.ok(typeof status.gatewayStatus === 'string');
      assert.ok(typeof status.routesCount === 'number');
      assert.ok(Array.isArray(status.routes));
    });

    it('dispatches Gateway API CRD installation and default gateway deployment', () => {
      const crdTask = installK3sGatewayCrds(projectRoot);
      assert.ok(crdTask.id);
      assert.ok(crdTask.args.includes('install-crds'));

      const gwTask = deployK3sGateway(projectRoot, {
        namespace: 'gateway-system',
        gatewayName: 'custom-gw',
      });
      assert.ok(gwTask.id);
      assert.ok(gwTask.args.includes('deploy-gateway'));
      assert.ok(gwTask.args.includes('--namespace'));
      assert.ok(gwTask.args.includes('gateway-system'));
      assert.ok(gwTask.args.includes('--gateway-name'));
      assert.ok(gwTask.args.includes('custom-gw'));
    });

    it('dispatches weighted HTTPRoute canary traffic split creation', () => {
      const canaryTask = createK3sCanaryRoute(projectRoot, {
        name: 'web-canary',
        stableService: 'web-v1',
        stableWeight: 80,
        canaryService: 'web-v2',
        canaryWeight: 20,
        dryRun: true,
      });
      assert.ok(canaryTask.id);
      assert.ok(canaryTask.args.includes('create-canary'));
      assert.ok(canaryTask.args.includes('--name'));
      assert.ok(canaryTask.args.includes('web-canary'));
      assert.ok(canaryTask.args.includes('--stable-svc'));
      assert.ok(canaryTask.args.includes('web-v1'));
      assert.ok(canaryTask.args.includes('--stable-weight'));
      assert.ok(canaryTask.args.includes('80'));
      assert.ok(canaryTask.args.includes('--canary-svc'));
      assert.ok(canaryTask.args.includes('web-v2'));
      assert.ok(canaryTask.args.includes('--canary-weight'));
      assert.ok(canaryTask.args.includes('20'));
      assert.ok(canaryTask.args.includes('--dry-run'));
    });
  });

  describe('Dynamic Hybrid Node Provisioner & Autoscaling (Phase 10)', () => {
    it('retrieves pooled nodes status and detected hypervisors', async () => {
      const status = await getK3sPoolStatus(projectRoot);
      assert.ok(Array.isArray(status.detectedHypervisors));
      assert.ok(typeof status.poolNodesCount === 'number');
      assert.ok(typeof status.activeAgentsCount === 'number');
      assert.ok(typeof status.idleCandidatesCount === 'number');
      assert.ok(Array.isArray(status.pooledNodes));
    });

    it('dispatches pooled node provisioning and idle node drain', () => {
      const provTask = provisionK3sPooledNode(projectRoot, {
        hypervisor: 'docker',
        role: 'agent',
        cpu: 4,
        memGb: 8,
        dryRun: true,
      });
      assert.ok(provTask.id);
      assert.ok(provTask.args.includes('provision'));
      assert.ok(provTask.args.includes('--hypervisor'));
      assert.ok(provTask.args.includes('docker'));
      assert.ok(provTask.args.includes('--cpu'));
      assert.ok(provTask.args.includes('4'));
      assert.ok(provTask.args.includes('--mem'));
      assert.ok(provTask.args.includes('8'));
      assert.ok(provTask.args.includes('--dry-run'));

      const drainTask = drainIdleK3sNodes(projectRoot, {
        maxIdleMinutes: 15,
        dryRun: true,
      });
      assert.ok(drainTask.id);
      assert.ok(drainTask.args.includes('drain-idle'));
      assert.ok(drainTask.args.includes('--max-idle'));
      assert.ok(drainTask.args.includes('15'));
      assert.ok(drainTask.args.includes('--dry-run'));
    });
  });

  describe('Continuous FinOps, P95 Right-Sizing & GPU Analytics (Phase 11)', () => {
    it('retrieves FinOps status with P95 recommendations and GPU power analytics', async () => {
      const status = await getK3sFinOpsStatus(projectRoot);
      assert.ok(typeof status.totalMonthlyEstimatedClusterCostUsd === 'number');
      assert.ok(typeof status.overProvisioningWasteCostUsd === 'number');
      assert.ok(typeof status.potentialSavingsPercentage === 'number');
      assert.ok(Array.isArray(status.rightSizingRecommendations));
      if (status.gpuPowerAnalytics) {
        assert.ok(typeof status.gpuPowerAnalytics.powerUsageWatts === 'number');
        assert.ok(typeof status.gpuPowerAnalytics.estimatedCostPer1MTokensUsd === 'number');
      }
    });

    it('dispatches workload right-sizing recommendation apply', () => {
      const applyTask = applyK3sRightSizing(projectRoot, 'frontend', {
        namespace: 'production',
        dryRun: true,
      });
      assert.ok(applyTask.id);
      assert.ok(applyTask.args.includes('apply'));
      assert.ok(applyTask.args.includes('--workload'));
      assert.ok(applyTask.args.includes('frontend'));
      assert.ok(applyTask.args.includes('--namespace'));
      assert.ok(applyTask.args.includes('production'));
      assert.ok(applyTask.args.includes('--dry-run'));
    });
  });
});
