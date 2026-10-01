import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  validateCommand,
  ALLOWED_EXECUTABLES,
  generateRandomSecret,
  generateClusterSecrets,
  loadProjectConfig,
  saveEnvFile,
  saveEnablerFile,
  FluxManager,
  generateK3sOneLiner,
  generateK3sJoinScript,
  saveK3sJoinScript,
  getK3sJoinInfo,
  resolveK3sServer,
  provisionK3sBatchNodes,
  tuneK3sNode,
  kmodK3sNode,
  pingK3sNodes,
  killK3sCluster,
  buildK3sCluster,
  upK3sCluster,
  deployK3sRegistries,
  APP_CATALOG,
  findAgyBinary,
  getAntigravityEngineStatus,
  buildClusterContext,
  askAntigravity,
  streamAntigravity,
  detectManifestPatch,
  runClusterWatchdogScan,
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
  getCopilotTools,
  executeCopilotTool,
  listLocalCharts,
  getLocalChartDetail,
  getChartsDirectory,
  setChartsDirectory,
  getCombinedAppCatalog,
  lintLocalChart,
  templateLocalChart,
  installLocalChart,
  uninstallLocalChart,
  findProjectRoot,
} from '../index.js';

describe('Orchestrator Security & Smoke Tests', () => {
  const projectRoot = findProjectRoot();

  describe('Command Validation & Allowlist', () => {
    it('allows all approved standard binaries', () => {
      for (const binary of ALLOWED_EXECUTABLES) {
        const res = validateCommand(binary, ['--help'], projectRoot);
        assert.equal(res.allowed, true, `Expected ${binary} to be allowed`);
        assert.equal(res.normalizedCommand, binary);
      }
    });

    it('allows project scripts (up and src/*.sh)', () => {
      const upRes = validateCommand('up', [], projectRoot);
      assert.equal(upRes.allowed, true, 'Expected "up" to be allowed');

      const hostrRes = validateCommand('bash', ['src/hostr.sh'], projectRoot);
      assert.equal(hostrRes.allowed, true, 'Expected "bash src/hostr.sh" to be allowed');
    });

    it('rejects arbitrary dangerous binaries', () => {
      const dangerous = ['rm', 'curl', 'wget', 'python', 'perl', 'nc', 'sh', 'cat'];
      for (const cmd of dangerous) {
        const res = validateCommand(cmd, ['-rf', '/'], projectRoot);
        assert.equal(res.allowed, false, `Expected ${cmd} to be blocked`);
        assert.match(res.reason || '', /allowlist/i);
      }
    });

    it('strictly rejects bash -c and evaluation flags', () => {
      const cRes = validateCommand('bash', ['-c', 'rm -rf /'], projectRoot);
      assert.equal(cRes.allowed, false);
      assert.match(cRes.reason || '', /forbidden/i);

      const sRes = validateCommand('bash', ['-s'], projectRoot);
      assert.equal(sRes.allowed, false);
    });

    it('rejects directory traversal in script execution', () => {
      const travRes = validateCommand('bash', ['../../etc/shadow'], projectRoot);
      assert.equal(travRes.allowed, false);
      assert.match(travRes.reason || '', /repository root/i);
    });
  });

  describe('Secret Generation (Unbiased Randomness)', () => {
    it('generates secrets of exact requested length', () => {
      const secret24 = generateRandomSecret(24);
      assert.equal(secret24.length, 24);
      assert.match(secret24, /^[A-Za-z0-9]+$/);

      const secret48 = generateRandomSecret(48, 'all');
      assert.equal(secret48.length, 48);
    });

    it('generates distinct secrets without collision', () => {
      const set = new Set<string>();
      for (let i = 0; i < 50; i++) {
        set.add(generateRandomSecret(16));
      }
      assert.equal(set.size, 50, 'All 50 generated secrets should be unique');
    });

    it('generates complete cluster secret suite', () => {
      const secrets = generateClusterSecrets({
        secretName: 'test-secrets',
        namespace: 'test-ns',
      });
      assert.equal(secrets.secretName, 'test-secrets');
      assert.equal(secrets.namespace, 'test-ns');
      assert.ok(secrets.items['argocdadmin-password']);
      assert.ok(secrets.secretYaml.includes('kind: Secret'));
    });
  });

  describe('Config Parsing & Sanitization', () => {
    it('loads project config and parses defaults correctly', () => {
      const config = loadProjectConfig(projectRoot);
      assert.ok(config.raw);
      assert.ok(config.cluster);
      assert.ok(['kind', 'k3d', 'k3s'].includes(config.cluster.k8sPlatform));
    });

    it('sanitizes environment keys during file generation', () => {
      // Test that invalid keys and injection strings are handled cleanly
      const testMap: Record<string, string> = {
        VALID_KEY: 'safe_value',
        'INVALID;INJECTED': 'malicious',
        ANOTHER_KEY: 'value "with" quotes\nand newlines',
      };

      // saveEnvFile to a scratch/mock path
      const tmpDir = path.resolve(projectRoot, '.vow-cache/test');
      import('node:fs').then((fs) => {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        saveEnvFile(tmpDir, testMap);
        const written = fs.readFileSync(path.join(tmpDir, '.env'), 'utf-8');
        assert.ok(written.includes('VALID_KEY="safe_value"'));
        assert.ok(!written.includes('INVALID;INJECTED'));
        assert.ok(!written.includes('\nand newlines\n'));
      });
    });
  });

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
    it('allows k3s, ssh, scp, and parallel binaries in command allowlist', () => {
      assert.ok(ALLOWED_EXECUTABLES.has('k3s'), 'k3s must be in ALLOWED_EXECUTABLES');
      assert.ok(ALLOWED_EXECUTABLES.has('ssh'), 'ssh must be in ALLOWED_EXECUTABLES');
      assert.ok(ALLOWED_EXECUTABLES.has('scp'), 'scp must be in ALLOWED_EXECUTABLES');
      assert.ok(ALLOWED_EXECUTABLES.has('parallel'), 'parallel must be in ALLOWED_EXECUTABLES');

      const k3sRes = validateCommand('k3s', ['--version'], projectRoot);
      assert.equal(k3sRes.allowed, true);

      const sshRes = validateCommand('ssh', ['-p', '22', 'ubuntu@192.168.1.50'], projectRoot);
      assert.equal(sshRes.allowed, true);

      const scpRes = validateCommand('scp', ['file.txt', 'root@192.168.1.50:/tmp/'], projectRoot);
      assert.equal(scpRes.allowed, true);

      const parRes = validateCommand('parallel', ['--version'], projectRoot);
      assert.equal(parRes.allowed, true);
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
        rebuild: true,
        skipUp: true,
      });
      assert.ok(buildTask.id);
      assert.ok(buildTask.args.some((a) => a.includes('k3s_build.sh')));
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

  describe('App Catalog & Override Security', () => {
    it('ensures all catalog IDs conform to safe alphanumeric characters without path separators', () => {
      assert.ok(APP_CATALOG.length > 0);
      for (const app of APP_CATALOG) {
        assert.match(
          app.id,
          /^[a-zA-Z0-9_-]+$/,
          `App ID "${app.id}" must not contain path separators or illegal characters`
        );
      }
    });

    it('rejects path traversal attempts and arbitrary file writing in app IDs', () => {
      const maliciousIds = [
        '../evil',
        '../../etc/passwd',
        'foo/bar',
        'foo\\bar',
        '..',
        '.',
        'nextcloud/../../bin',
      ];
      for (const id of maliciousIds) {
        const isValid = /^[a-zA-Z0-9_-]+$/.test(id);
        const inCatalog = Boolean(APP_CATALOG.find((a) => a.id === id));
        assert.equal(
          isValid && inCatalog,
          false,
          `Malicious ID "${id}" must fail validation and catalog lookup`
        );
      }
    });
  });

  describe('Antigravity Cluster Copilot Integration', () => {
    it('detects Antigravity CLI binary and returns engine status with Ollama and vLLM providers', async () => {
      const status = await getAntigravityEngineStatus();
      assert.ok(typeof status.available === 'boolean');
      assert.ok(status.defaultModel.includes('gemini'));
      assert.ok(status.availableModels.length > 0);
      assert.ok(status.availableModels.includes('gemini-3.8-flash-high'));
      assert.ok(status.providers.antigravity);
      assert.ok(status.providers.ollama);
      assert.ok(status.providers.vllm);
      assert.ok(status.providers.ollama.models.length > 0);
      assert.ok(status.providers.vllm.models.length > 0);
    });

    it('builds live cluster context snapshot with telemetry and apps', async () => {
      const { promptContext, snapshot } = await buildClusterContext(projectRoot);
      assert.ok(typeof promptContext === 'string');
      assert.ok(promptContext.includes('Live Kubernetes Cluster Telemetry'));
      assert.ok(promptContext.includes('Supported App Store Catalog'));
      assert.ok(snapshot);
      assert.ok(typeof snapshot.connected === 'boolean');
      assert.ok(typeof snapshot.nodeCount === 'number');
      assert.ok(typeof snapshot.podCount === 'number');
      assert.ok(Array.isArray(snapshot.unhealthyPods));
      assert.equal(snapshot.applicationsCount, APP_CATALOG.length);
    });

    it('answers cluster questions with structured response and snapshot', async () => {
      const result = await askAntigravity({
        prompt: 'What is the status of the cluster?',
        includeClusterContext: true,
        root: projectRoot,
      });

      assert.ok(result);
      assert.ok(result.response && result.response.length > 0);
      assert.ok(['antigravity-cli', 'cluster-copilot-engine'].includes(result.engineUsed));
      assert.ok(result.clusterSnapshot);
      assert.ok(typeof result.clusterSnapshot.nodeCount === 'number');
    });

    it('handles Ollama provider query with fallback or live connection', async () => {
      const result = await askAntigravity({
        prompt: 'What pods are in namespace default?',
        provider: 'ollama',
        model: 'llama3:latest',
        includeClusterContext: true,
        root: projectRoot,
      });

      assert.ok(result);
      assert.equal(result.provider, 'ollama');
      assert.equal(result.modelUsed, 'llama3:latest');
      assert.ok(result.response && result.response.length > 0);
      assert.ok(['ollama', 'cluster-copilot-engine'].includes(result.engineUsed));
    });

    it('handles vLLM provider query with fallback or live connection', async () => {
      const result = await askAntigravity({
        prompt: 'How to inspect certificates in cluster?',
        provider: 'vllm',
        model: 'meta-llama/Meta-Llama-3-8B-Instruct',
        includeClusterContext: true,
        root: projectRoot,
      });

      assert.ok(result);
      assert.equal(result.provider, 'vllm');
      assert.equal(result.modelUsed, 'meta-llama/Meta-Llama-3-8B-Instruct');
      assert.ok(result.response && result.response.length > 0);
      assert.ok(['vllm', 'cluster-copilot-engine'].includes(result.engineUsed));
    });

    it('detects Kubernetes YAML manifests and correlates with APP_CATALOG', () => {
      const sampleMarkdown = `
Here is how to deploy a custom ingress for Spegel:
\`\`\`yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: spegel-ingress
  namespace: kube-system
spec:
  rules:
  - host: spegel.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: spegel
            port:
              number: 80
\`\`\`

And here is a regular bash command:
\`\`\`bash
kubectl get ingress -A
\`\`\`
`;
      const detected = detectManifestPatch(sampleMarkdown);
      assert.equal(detected.length, 1);
      assert.equal(detected[0].kind, 'Ingress');
      assert.equal(detected[0].name, 'spegel-ingress');
      assert.equal(detected[0].namespace, 'kube-system');
      assert.equal(detected[0].targetAppId, 'spegel');
    });

    it('streams real-time events and incremental chunks with streamAntigravity', async () => {
      const events: any[] = [];
      const result = await streamAntigravity(
        {
          prompt: 'What is the cluster status?',
          includeClusterContext: true,
          root: projectRoot,
        },
        (event) => {
          events.push(event);
        }
      );

      assert.ok(result);
      assert.ok(events.length > 0);
      assert.ok(events.some((e) => e.type === 'status'));
      assert.ok(events.some((e) => e.type === 'chunk'));
      assert.ok(events.some((e) => e.type === 'done'));
      const doneEvt = events.find((e) => e.type === 'done');
      assert.ok(doneEvt.response);
      assert.equal(doneEvt.response.response, result.response);
    });

    it('executes runClusterWatchdogScan to produce deep health analysis', async () => {
      const watchdog = await runClusterWatchdogScan(projectRoot, { effort: 'low' });
      assert.ok(watchdog);
      assert.ok(watchdog.response.length > 0);
      assert.ok(watchdog.clusterSnapshot);
    });

    it('registers in-cluster Ollama and vLLM in APP_CATALOG with valid ArgoCD manifests', () => {
      const ollamaApp = APP_CATALOG.find((a) => a.id === 'ollama');
      assert.ok(ollamaApp, 'Ollama must be in APP_CATALOG');
      assert.equal(ollamaApp.category, 'AI, ML & GPU');
      assert.equal(ollamaApp.port, 11434);

      const vllmApp = APP_CATALOG.find((a) => a.id === 'vllm');
      assert.ok(vllmApp, 'vLLM must be in APP_CATALOG');
      assert.equal(vllmApp.category, 'AI, ML & GPU');
      assert.equal(vllmApp.port, 8000);
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

  describe('Autonomous Tool-Calling Agent Copilot (Phase 12 Platform Copilot)', () => {
    it('exposes rich tool registry with parameter definitions', () => {
      const tools = getCopilotTools();
      assert.ok(tools.length >= 8);

      const healerTool = tools.find((t) => t.id === 'run_cluster_healer');
      assert.ok(healerTool);
      assert.equal(healerTool.category, 'remediation');
      assert.ok(healerTool.parameters.autoRemediate);

      const drTool = tools.find((t) => t.id === 'run_dr_drill');
      assert.ok(drTool);
      assert.equal(drTool.category, 'inspection');

      const finopsTool = tools.find((t) => t.id === 'inspect_finops');
      assert.ok(finopsTool);

      const canaryTool = tools.find((t) => t.id === 'split_canary_traffic');
      assert.ok(canaryTool);
    });

    it('executes copilot tools and returns tasks', async () => {
      const resHealer = await executeCopilotTool(projectRoot, 'run_cluster_healer', { dryRun: true });
      assert.equal(resHealer.success, true);
      assert.ok(resHealer.taskId);

      const resDrill = await executeCopilotTool(projectRoot, 'run_dr_drill', { dryRun: true });
      assert.equal(resDrill.success, true);
      assert.ok(resDrill.taskId);

      const resUnknown = await executeCopilotTool(projectRoot, 'invalid_tool');
      assert.equal(resUnknown.success, false);
      assert.ok(resUnknown.message.includes('Unknown Copilot tool'));
    });
  });

  describe('Local Helm Charts & Custom Directories (Phase 13)', () => {
    it('resolves and configures charts directory properly', () => {
      const dir = getChartsDirectory(projectRoot);
      assert.ok(typeof dir === 'string' && dir.length > 0);
      assert.ok(path.isAbsolute(dir));
    });

    it('discovers local charts in default and example directories', () => {
      const defaultCharts = listLocalCharts(projectRoot);
      assert.ok(Array.isArray(defaultCharts));
      assert.ok(defaultCharts.length > 0, 'Expected at least one chart in default charts dir');

      const sampleChart = defaultCharts.find((c) => c.id === 'sample-app');
      assert.ok(sampleChart, 'Expected sample-app chart to be discovered');
      assert.equal(sampleChart.valid, true);
      assert.equal(sampleChart.category, 'Custom & Local Charts');
      assert.ok(sampleChart.templateCount > 0);
      assert.equal(sampleChart.hasValues, true);
      assert.equal(sampleChart.isLocalChart, true);

      // Verify custom example.charts directory discovery
      const exampleCharts = listLocalCharts(projectRoot, 'example.charts');
      assert.ok(exampleCharts.length >= 2, 'Expected at least sample-app and static-site in example.charts');
      const staticSite = exampleCharts.find((c) => c.id === 'static-site');
      assert.ok(staticSite);
      assert.equal(staticSite.valid, true);
    });

    it('retrieves full chart detail including raw manifests and templates', () => {
      const detail = getLocalChartDetail(projectRoot, 'sample-app');
      assert.ok(detail);
      assert.ok(detail.rawChartYaml.includes('sample-app'));
      assert.ok(detail.rawValuesYaml.includes('replicaCount'));
      assert.ok(detail.templates.length > 0);
      assert.ok(detail.templates.some((t) => t.name === 'deployment.yaml'));
    });

    it('merges discovered local charts into combined application catalog', () => {
      const combined = getCombinedAppCatalog(projectRoot);
      assert.ok(combined.length > APP_CATALOG.length, 'Combined catalog must include local charts');
      const sampleApp = combined.find((a) => a.id === 'sample-app');
      assert.ok(sampleApp, 'sample-app must appear in combined app catalog');
      assert.equal(sampleApp.category, 'Custom & Local Charts');
      assert.equal(sampleApp.isLocalChart, true);
    });

    it('runs helm lint against the example chart and reports 0 errors', async () => {
      const lintResult = await lintLocalChart(projectRoot, 'sample-app');
      assert.equal(lintResult.valid, true);
      assert.ok(lintResult.output.includes('0 chart(s) failed'));
    });

    it('renders Kubernetes manifests via helm template', async () => {
      const rendered = await templateLocalChart(projectRoot, 'sample-app');
      assert.ok(rendered.includes('kind: Deployment'));
      assert.ok(rendered.includes('kind: Service'));
      assert.ok(rendered.includes('kind: Ingress'));
    });

    it('dispatches install and uninstall tasks via processManager', () => {
      const installTask = installLocalChart(projectRoot, 'sample-app', {
        releaseName: 'test-sample',
        namespace: 'test-ns',
        wait: false,
      });
      assert.ok(installTask);
      assert.ok(installTask.id);
      assert.equal(installTask.command, 'helm');

      const uninstallTask = uninstallLocalChart(projectRoot, 'test-sample', 'test-ns');
      assert.ok(uninstallTask);
      assert.ok(uninstallTask.id);
      assert.equal(uninstallTask.command, 'helm');
    });
  });
});


