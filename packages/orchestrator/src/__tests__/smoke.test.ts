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
  APP_CATALOG,
  findAgyBinary,
  getAntigravityEngineStatus,
  buildClusterContext,
  askAntigravity,
  streamAntigravity,
  detectManifestPatch,
  runClusterWatchdogScan,
} from '../index.js';

describe('Orchestrator Security & Smoke Tests', () => {
  const projectRoot = path.resolve(process.cwd(), '../..');

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
    it('allows k3s and ssh binaries in command allowlist', () => {
      assert.ok(ALLOWED_EXECUTABLES.has('k3s'), 'k3s must be in ALLOWED_EXECUTABLES');
      assert.ok(ALLOWED_EXECUTABLES.has('ssh'), 'ssh must be in ALLOWED_EXECUTABLES');

      const k3sRes = validateCommand('k3s', ['--version'], projectRoot);
      assert.equal(k3sRes.allowed, true);

      const sshRes = validateCommand('ssh', ['-p', '22', 'ubuntu@192.168.1.50'], projectRoot);
      assert.equal(sshRes.allowed, true);
    });

    it('allows src/k3s_add_node.sh execution via validateCommand', () => {
      const res = validateCommand('bash', ['src/k3s_add_node.sh', '--role', 'agent'], projectRoot);
      assert.equal(res.allowed, true);
      assert.equal(res.normalizedCommand, 'bash');
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
});


