import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  APP_CATALOG,
  buildClusterContext,
  detectManifestPatch,
  getCopilotTools,
  executeCopilotTool,
  listLocalCharts,
  getLocalChartDetail,
  getChartsDirectory,
  getCombinedAppCatalog,
  lintLocalChart,
  templateLocalChart,
  installLocalChart,
  uninstallLocalChart,
  findProjectRoot,
} from '../index.js';
import { binaryAvailable } from './helpers.js';

/**
 * Antigravity copilot (offline-safe parts), tool-calling copilot, and
 * local Helm charts smoke tests. Split out of smoke.test.ts by
 * Plan III §5.2 — test bodies are verbatim moves. The live-provider
 * Antigravity tests live in antigravity-live.test.ts (opt-in).
 */

// Plan II §7.2: skip cleanly when helm is absent (see helpers.ts).
const hasHelm = binaryAvailable('helm');

describe('Copilot & Local Charts Smoke Tests', () => {
  const projectRoot = findProjectRoot();

  describe('Antigravity Cluster Copilot Integration', () => {
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

    it('runs helm lint against the example chart and reports 0 errors', { skip: hasHelm ? false : 'helm binary not available' }, async () => {
      const lintResult = await lintLocalChart(projectRoot, 'sample-app');
      assert.equal(lintResult.valid, true);
      assert.ok(lintResult.output.includes('0 chart(s) failed'));
    });

    it('renders Kubernetes manifests via helm template', { skip: hasHelm ? false : 'helm binary not available' }, async () => {
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
