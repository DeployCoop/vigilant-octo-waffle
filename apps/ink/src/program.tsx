import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './components/App.js';
import {
  checkConfig,
  reconcileConfig,
  syncSecretsAcrossNamespaces,
  applyClusterNamespaces,
  discoverClusterNamespaces,
  createBringUpEngine,
  parseWaffleYaml,
  validateWafflePipeline,
  WaffleRunner,
  getBuiltinBlueprints,
  getIngressFabricStatus,
  deployIngressFabric,
  setupMkcert,
  setupLetsEncrypt,
  getStorageFabricStatus,
  deployOpenEBS,
  runStorageBenchmark,
  listCatalogApps,
  deployCatalogApp,
  removeCatalogApp,
  getCatalogAppStatus,
  getK3sHealthScore,
  runK3sCisAudit,
  getK3sNodes,
  drainK3sNodeLive,
  cordonK3sNodeLive,
} from '@vow/orchestrator';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Commander setup for the non-interactive `vow` CLI, extracted from
 * cli.tsx (WS7) so the command surface can be unit-tested without
 * executing the entry point. Behavior is identical to the previous
 * inline setup.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('vow')
    .description('Vigilant Octo Waffle: Modern Kubernetes Orchestrator & Ink CLI')
    .version('1.0.0')
    .option('-i, --interactive', 'Run interactive Ink terminal UI (default when no command given)');

  // Command: up
  program
    .command('up')
    .description('Bring up cluster, namespaces, secrets, ingress, and GitOps engines')
    .option('--dry-run', 'Simulate cluster bring-up without applying resources')
    .option('--interactive', 'Display interactive Ink bringup screen')
    .action(async (opts) => {
      if (opts.interactive || process.stdout.isTTY && !process.env.CI && !opts.dryRun) {
        render(<App initialScreen="up" dryRun={opts.dryRun} />);
      } else {
        console.log('==> Bringing up cluster via native TypeScript engine...');
        const engine = createBringUpEngine();
        engine.on('progress', (p) => {
          if (p.currentStepId) {
            const step = p.steps[p.currentStepIndex];
            console.log(`  ▶ [${p.currentStepIndex + 1}/${p.totalSteps}] ${step?.name} (${step?.status})`);
          }
        });
        const res = await engine.execute({ dryRun: opts.dryRun });
        console.log(`==> Cluster bringup result: ${res.status.toUpperCase()}`);
        if (res.status !== 'completed') process.exit(1);
      }
    });

  // Command: doctor
  program
    .command('doctor')
    .description('Audit configuration and cascade dependencies')
    .option('--fix', 'Automatically repair stale and corrupt cascaded variables')
    .action((opts) => {
      if (opts.fix) {
        const res = reconcileConfig(process.cwd());
        const fixedKeys = Object.keys(res.fixesApplied || {});
        console.log(`✔ Reconciled configuration: Fixed ${fixedKeys.length} keys: ${fixedKeys.join(', ') || 'already synchronized'}`);
      } else {
        const rep = checkConfig(process.cwd());
        console.log(rep.valid ? '✔ Configuration clean: 0 issues' : `⚠ ${rep.issues.length} issues found:`);
        for (const iss of rep.issues) {
          console.log(`  • [${iss.category.toUpperCase()}] ${iss.key}: ${iss.message}`);
        }
      }
    });

  // Command: secrets
  program
    .command('secrets [action]')
    .description('Manage modular secrets and cross-namespace Reflector distribution')
    .option('--dry-run', 'Simulate secret sync without applying')
    .action(async (action = 'sync', opts) => {
      if (action === 'sync') {
        const res = await syncSecretsAcrossNamespaces(process.cwd(), { applyLiveCluster: !opts.dryRun });
        console.log(`✔ Synchronized secrets across ${res.syncedNamespaces.length} namespaces: ${res.syncedNamespaces.join(', ')}`);
      }
    });

  // Command: namespaces
  program
    .command('namespaces [action]')
    .description('Declarative namespace registry and Pod Security Standards')
    .option('--dry-run', 'Print namespace manifests without applying')
    .action(async (_action = 'sync', opts) => {
      if (opts.dryRun) {
        const disc = discoverClusterNamespaces();
        console.log(`Discovered ${disc.total} namespaces:`);
        for (const ns of disc.namespaces) {
          console.log(`  • ${ns.name.padEnd(20)} [${ns.category}] enforce=${ns.pssEnforce} warn=${ns.pssWarn}`);
        }
      } else {
        const res = await applyClusterNamespaces(process.cwd(), { dryRun: opts.dryRun });
        console.log(`✔ Synchronized ${res.total} namespaces with PSS standards.`);
      }
    });

  // Command: waffle
  program
    .command('waffle <subaction> [pipelineFile]')
    .description('Execute or validate Waffle meta-package pipelines')
    .option('--dry-run', 'Simulate pipeline execution')
    .action(async (subaction, pipelineFile, opts) => {
      if (subaction === 'blueprints') {
        const list = getBuiltinBlueprints();
        console.log(`Available Built-in Blueprints (${list.length}):`);
        for (const b of list) {
          console.log(`  • ${b.metadata.name.padEnd(30)} : ${b.metadata.description}`);
        }
        return;
      }

      const filePath = pipelineFile || path.join(process.cwd(), 'charts', 'waffle.yaml');
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
      }

      const resolvedPath = path.resolve(filePath);
      const baseDir = fs.statSync(resolvedPath).isDirectory() ? resolvedPath : path.dirname(resolvedPath);

      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const pipe = parseWaffleYaml(raw);

      if (subaction === 'validate') {
        const res = validateWafflePipeline(pipe, baseDir);
        console.log(res.valid ? `✔ Pipeline '${pipe.metadata.name}' valid` : `✖ Validation failed: ${res.errors.join(', ')}`);
        if (!res.valid) process.exit(1);
      } else if (subaction === 'run') {
        console.log(`==> Running Waffle pipeline '${pipe.metadata.name}'...`);
        const runner = new WaffleRunner(baseDir);
        runner.on('progress', (p) => {
          if (p.currentStep) console.log(`  ▶ Step: ${p.currentStep} (${p.status})`);
        });
        const record = await runner.executePipeline({
          sourceId: pipe.metadata.name,
          pipeline: pipe,
          baseDir,
          dryRun: opts.dryRun,
        });
        console.log(`✔ Pipeline finished with status: ${record.status.toUpperCase()}`);
      }
    });

  // Command: ingress
  program
    .command('ingress [action]')
    .description('Manage Ingress controllers, TLS issuers, and certificates')
    .action(async (action = 'status') => {
      if (action === 'status') {
        const s = await getIngressFabricStatus(process.cwd());
        console.log(`Active Ingress Provider: ${s.activeProvider.toUpperCase()} (${s.isControllerReady ? 'Ready' : 'Pending/Offline'})`);
        console.log(`Ingress Classes: ${s.ingressClasses.join(', ') || 'none'}`);
        console.log(`Cert-Manager: Installed=${s.certManager.isInstalled} PodsReady=${s.certManager.podsReady}`);
        console.log(`Issuers (${s.certManager.issuers.length}): ${s.certManager.issuers.map(i => `${i.name} [${i.ready ? 'Ready' : 'NotReady'}]`).join(', ') || 'none'}`);
        console.log(`Discovered Ingress Routes (${s.ingresses.length}):`);
        for (const ing of s.ingresses) {
          console.log(`  • ${ing.namespace.padEnd(16)} ${ing.name.padEnd(25)} -> ${ing.host}`);
        }
      } else if (action === 'deploy') {
        console.log('==> Deploying Ingress & TLS fabric...');
        const res = await deployIngressFabric(process.cwd());
        console.log(res.success ? `✔ ${res.message}` : `✖ ${res.message}: ${res.error}`);
      } else if (action === 'certs') {
        console.log('==> Setting up certificates...');
        try {
          const res = await setupMkcert(process.cwd());
          console.log(`✔ ${res.output}`);
        } catch {
          const res = await setupLetsEncrypt(process.cwd());
          console.log(`✔ ${res.output}`);
        }
      }
    });

  // Command: storage
  program
    .command('storage [action] [arg]')
    .description('Manage distributed storage fabric, OpenEBS LocalPV, and performance benchmarks')
    .action(async (action = 'status', arg) => {
      if (action === 'status') {
        const s = await getStorageFabricStatus(process.cwd());
        console.log(`Primary Storage Engine: ${s.primaryEngine}`);
        console.log(`StorageClasses (${s.storageClasses.length}): ${s.storageClasses.map(c => `${c.name}${c.isDefault ? ' (default)' : ''}`).join(', ') || 'none'}`);
        console.log(`Volumes: ${s.totalPVs} PVs | ${s.boundPVCs} Bound PVCs | ${s.unboundPVCs} Pending PVCs`);
        console.log(`Host Volume Groups: ${s.hostVolumeGroups.join(', ') || 'none detected'}`);
        console.log(`Prerequisites (${s.prereqs.length}): ${s.prereqs.map(p => `${p.name}: ${p.passed ? 'PASS' : 'WARN'}`).join(' | ')}`);
      } else if (action === 'deploy') {
        console.log('==> Deploying OpenEBS storage fabric...');
        const res = await deployOpenEBS(process.cwd());
        console.log(`✔ OpenEBS deployed: ${res.output}`);
      } else if (action === 'bench') {
        const sc = arg || 'local-path';
        console.log(`==> Running storage benchmark against StorageClass '${sc}'...`);
        const res = await runStorageBenchmark(process.cwd(), sc);
        if (res.success) {
          console.log(`✔ Benchmark completed on '${sc}': Write Speed = ${res.writeSpeedMbSec} MB/s | Est IOPS = ${res.iops} | Latency = ${res.latencyMs}ms`);
        } else {
          console.log(`✖ Benchmark failed: ${res.error}`);
        }
      }
    });

  // Command: app
  program
    .command('app <action> [appId]')
    .description('Manage application catalog, lifecycle, and deployments')
    .option('--engine <engine>', 'Deployment engine (argocd, helm, flux)', 'argocd')
    .action(async (action, appId, opts) => {
      if (action === 'list') {
        const apps = listCatalogApps(process.cwd());
        console.log(`Application Catalog (${apps.length} available):`);
        for (const a of apps) {
          console.log(`  • ${a.appId.padEnd(24)} [${a.category.padEnd(26)}] defaultNs=${a.defaultNamespace.padEnd(16)} (argo=${a.hasArgoManifest}, helm=${a.hasLocalChart})`);
        }
      } else if (action === 'deploy') {
        if (!appId) {
          console.error('Error: app deploy requires an appId (e.g. vow app deploy nextcloud)');
          process.exit(1);
        }
        console.log(`==> Deploying application '${appId}' using engine '${opts.engine}'...`);
        const res = await deployCatalogApp(process.cwd(), appId, { engine: opts.engine });
        console.log(res.success ? `✔ ${res.message}` : `✖ ${res.message}: ${res.error}`);
      } else if (action === 'remove') {
        if (!appId) {
          console.error('Error: app remove requires an appId (e.g. vow app remove nextcloud)');
          process.exit(1);
        }
        const res = await removeCatalogApp(process.cwd(), appId);
        console.log(res.success ? `✔ ${res.message}` : `✖ ${res.message}`);
      } else if (action === 'status') {
        if (!appId) {
          console.error('Error: app status requires an appId');
          process.exit(1);
        }
        const s = await getCatalogAppStatus(process.cwd(), appId);
        console.log(`App '${appId}': Deployed=${s.isDeployed} Status=${s.status.toUpperCase()} (Pods: ${s.pods.length}, ArgoSync: ${s.argoSyncStatus || 'N/A'})`);
        for (const p of s.pods) {
          console.log(`  • ${p.name.padEnd(30)} ${p.status.padEnd(12)} ready=${p.ready} restarts=${p.restarts}`);
        }
      }
    });

  // Command: k3s
  program
    .command('k3s <action> [nodeName]')
    .description('Production K3s cluster administration, health watchdog, and CIS hardening')
    .action(async (action, nodeName) => {
      if (action === 'health') {
        const h = await getK3sHealthScore(process.cwd());
        console.log(`K3s Health Score: ${h.score}/100 [${h.grade}] | Latency: ${h.apiLatencyMs}ms | etcd: ${h.etcdQuorum ? 'HEALTHY' : 'DEGRADED'}`);
        console.log(`Nodes: ${h.nodes.total} total (${h.nodes.ready} ready, ${h.nodes.notReady} not-ready)`);
        console.log(`Pods: ${h.pods.total} total (${h.pods.running} running, ${h.pods.failing} failing, ${h.pods.totalRestarts} restarts)`);
        if (h.recommendations.length > 0) {
          console.log(`Alerts & Recommendations (${h.recommendations.length}):`);
          for (const r of h.recommendations) console.log(`  ⚠ ${r}`);
        }
      } else if (action === 'cis') {
        const c = await runK3sCisAudit(process.cwd());
        console.log(`CIS Benchmark Compliance: ${c.scorePercentage}% (${c.passedChecks} PASS / ${c.failedChecks} FAIL / ${c.warnChecks} WARN)`);
        for (const f of c.findings) {
          console.log(`  [${f.status.padEnd(4)}] ${f.id.padEnd(10)} ${f.description.padEnd(40)} ${f.details}`);
          if (f.remediation) console.log(`         ↪ Fix: ${f.remediation}`);
        }
      } else if (action === 'nodes') {
        const nodes = await getK3sNodes(process.cwd());
        console.log(`Cluster Nodes (${nodes.length}):`);
        for (const n of nodes) {
          console.log(`  • ${n.name.padEnd(20)} ${n.status.padEnd(12)} IP=${n.internalIp.padEnd(16)} roles=${n.roles.join(',')} version=${n.kubeletVersion}`);
        }
      } else if (action === 'drain') {
        if (!nodeName) {
          console.error('Error: k3s drain requires a node name');
          process.exit(1);
        }
        console.log(`==> Draining node '${nodeName}'...`);
        const res = await drainK3sNodeLive(process.cwd(), nodeName);
        console.log(res.success ? `✔ Node drained: ${res.output}` : `✖ Drain failed: ${res.output}`);
      } else if (action === 'cordon' || action === 'uncordon') {
        if (!nodeName) {
          console.error('Error: node name required');
          process.exit(1);
        }
        const res = await cordonK3sNodeLive(process.cwd(), nodeName, action === 'uncordon');
        console.log(res.success ? `✔ ${res.message}` : `✖ ${res.message}`);
      }
    });

  return program;
}

export type DispatchMode = 'authz' | 'tui' | 'commander';

/**
 * Entry-point dispatch, exactly as the CLI has always behaved:
 * - `vow authz ...` is delegated raw to the orchestrator's authz CLI
 *   (commander would mangle its flags, so it bypasses the parser);
 * - no args, or -i/--interactive ANYWHERE in argv, launches the TUI
 *   (quirk: this also shadows the `up` command's own --interactive
 *   option, which therefore never reaches the parser — preserved
 *   deliberately; changing it is a behavior change, not a refactor);
 * - anything else goes through commander.
 */
export function resolveDispatch(rawArgs: string[]): DispatchMode {
  if (rawArgs[0] === 'authz') return 'authz';
  if (
    rawArgs.length === 0 ||
    rawArgs.includes('-i') ||
    rawArgs.includes('--interactive')
  ) {
    return 'tui';
  }
  return 'commander';
}
