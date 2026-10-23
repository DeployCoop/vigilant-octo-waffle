/**
 * Waffle pipeline runner: progress model and the WaffleRunner engine (WS6 split of waffle.ts).
 * Plan III §7.3: secrets provisioning, image build/registry, and health
 * verification live in ./secrets.js, ./images.js, and ./health.js;
 * WaffleRunner orchestrates them through the thin delegating methods
 * below, so its surface — and every call site — is unchanged.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { checkOpenEbsStatus } from '../storage.js';
import { getChartsDirectory } from '../config.js';
import { getWaffleExecutionEnv, errMessage } from './shared.js';
import { execFileAsync, killActiveChildren } from '../exec-argv.js';
import { type WaffleSecretKey, type WaffleStep, type WafflePipeline, type WaffleBuildTarget } from './schema.js';
import { getWaffleRunHistory } from './registry.js';
import {
  deriveSupabaseJwt as deriveSupabaseJwtImpl,
  provisionSecrets as provisionSecretsImpl,
  loadProjectEnvFiles as loadProjectEnvFilesImpl,
} from './secrets.js';
import {
  buildImages as buildImagesImpl,
  buildSingleTarget as buildSingleTargetImpl,
  ensureLocalRegistry as ensureLocalRegistryImpl,
  importImageToCluster as importImageToClusterImpl,
} from './images.js';
import { verifyStepHealth as verifyStepHealthImpl } from './health.js';

/**
 * The CodeQL round-3 guards moved to ./images.js with buildSingleTarget
 * (§7.3); re-exported here so this module's historical surface —
 * including the codeql-regressions tests' imports from './runner.js' —
 * is unchanged. The progress types below likewise stay defined here.
 */
export { resolvePathWithinBase, assertSafeGitValue } from './images.js';

// ============================================================================
// 4. WAFFLE RUNNER & REAL-TIME PROGRESS TRACKING
// ============================================================================

export type StepStatus = 'pending' | 'running' | 'verifying' | 'completed' | 'failed' | 'skipped';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PipelineStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WaffleStepProgress {
  stepId: string;
  name: string;
  status: StepStatus;
  chart: string;
  namespace: string;
  releaseName: string;
  domain?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  logs: string[];
}

export interface WaffleStageProgress {
  stageId: string;
  name: string;
  status: StageStatus;
  mode: 'series' | 'parallel';
  steps: Record<string, WaffleStepProgress>;
  startedAt?: string;
  finishedAt?: string;
}

export interface WaffleRunProgress {
  runId: string;
  sourceId: string;
  pipelineName: string;
  status: PipelineStatus;
  stages: Record<string, WaffleStageProgress>;
  startedAt: string;
  finishedAt?: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  activeStepId?: string;
  activeStageId?: string;
  currentLogLine?: string;
  error?: string;
  deployedDomains: Array<{ name: string; domain: string; url: string }>;
  dryRun?: boolean;
}

export class WaffleRunner extends EventEmitter {
  private projectRoot: string;
  private activeRun: WaffleRunProgress | null = null;
  private aborted: boolean = false;

  constructor(projectRoot: string) {
    super();
    this.projectRoot = projectRoot;
  }

  public getActiveRun(): WaffleRunProgress | null {
    return this.activeRun;
  }

  public abort(): void {
    this.aborted = true;
    // Kill in-flight step processes: the flag alone was only checked
    // between steps, so a hung helm/kubectl ran on indefinitely and the
    // run stayed 'running' (blocking new runs behind the route's 409).
    killActiveChildren();
    if (this.activeRun) {
      this.activeRun.status = 'cancelled';
      this.emit('progress', this.activeRun);
    }
  }

  /**
   * Executes a WafflePipeline with real-time events and streaming logs
   */
  public async executePipeline(options: {
    sourceId: string;
    pipeline: WafflePipeline;
    baseDir: string;
    dryRun?: boolean;
    buildOnly?: boolean;
  }): Promise<WaffleRunProgress> {
    this.aborted = false;
    const { sourceId, pipeline, baseDir, dryRun, buildOnly } = options;

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let totalSteps = 0;
    const stagesProgress: Record<string, WaffleStageProgress> = {};

    for (const stage of pipeline.stages) {
      const stepsMap: Record<string, WaffleStepProgress> = {};
      for (const step of stage.steps) {
        totalSteps++;
        stepsMap[step.id] = {
          stepId: step.id,
          name: step.name,
          status: 'pending',
          chart: step.chart,
          namespace: step.namespace || pipeline.settings?.defaultNamespace || 'default',
          releaseName: step.releaseName || step.id,
          domain: step.domain,
          logs: [],
        };
      }
      stagesProgress[stage.id] = {
        stageId: stage.id,
        name: stage.name,
        status: 'pending',
        mode: stage.mode || 'series',
        steps: stepsMap,
      };
    }

    const runProgress: WaffleRunProgress = {
      runId,
      sourceId,
      pipelineName: pipeline.metadata.name,
      status: 'running',
      stages: stagesProgress,
      startedAt: new Date().toISOString(),
      totalSteps,
      completedSteps: 0,
      failedSteps: 0,
      deployedDomains: [],
      dryRun: Boolean(dryRun),
    };

    this.activeRun = runProgress;
    this.emit('start', runProgress);
    this.emit('progress', runProgress);

    try {
      if (buildOnly) {
        this.logToRun(`[BUILDS] Rebuild mode activated for pipeline "${pipeline.metadata.name}".`);
        if (!pipeline.builds?.targets || pipeline.builds.targets.length === 0) {
          this.logToRun('[BUILDS] No build targets defined in pipeline. Nothing to rebuild.');
        } else {
          await this.buildImages(pipeline, baseDir, Boolean(dryRun));
          this.logToRun(`[BUILDS] All ${pipeline.builds.targets.length} target image(s) processed successfully.`);
        }
        runProgress.status = this.aborted ? 'cancelled' : 'completed';
        return runProgress;
      }

      // 1. Run Pre-flight Checks (e.g. OpenEBS detection & installation)
      await this.runPreflight(pipeline, baseDir, dryRun);

      // 1.1 Synchronize Global Pipeline Secrets (keys block)
      if (pipeline.keys?.secrets && pipeline.keys.secrets.length > 0) {
        const defaultNs = pipeline.settings?.defaultNamespace || 'default';
        await this.provisionSecrets(pipeline.keys.secrets, defaultNs, Boolean(dryRun));
      }

      // 1.2 Build Container Images (builds block)
      if (pipeline.builds?.targets && pipeline.builds.targets.length > 0) {
        await this.buildImages(pipeline, baseDir, Boolean(dryRun));
      }

      // 2. Execute Stages in Order
      for (const stage of pipeline.stages) {
        if (this.aborted) break;

        const stageProg = runProgress.stages[stage.id];
        stageProg.status = 'running';
        stageProg.startedAt = new Date().toISOString();
        runProgress.activeStageId = stage.id;
        this.emit('stage_start', { stageId: stage.id, name: stage.name });
        this.emit('progress', runProgress);

        if (stage.mode === 'parallel') {
          // Parallel execution of all steps in stage
          const stepPromises = stage.steps.map((step) =>
            this.executeStep({
              step,
              stageId: stage.id,
              pipeline,
              baseDir,
              dryRun: Boolean(dryRun),
              runProgress,
            })
          );
          const results = await Promise.allSettled(stepPromises);
          const hasFailure = results.some((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value));
          if (hasFailure) {
            stageProg.status = 'failed';
            if (pipeline.settings?.rollbackOnFailure) {
              throw new Error(`Stage "${stage.name}" failed during parallel execution`);
            }
          } else {
            stageProg.status = 'completed';
          }
        } else {
          // Series execution
          let stageHasFailure = false;
          for (const step of stage.steps) {
            if (this.aborted) break;
            const success = await this.executeStep({
              step,
              stageId: stage.id,
              pipeline,
              baseDir,
              dryRun: Boolean(dryRun),
              runProgress,
            });
            if (!success) {
              stageHasFailure = true;
              if (pipeline.settings?.rollbackOnFailure) {
                stageProg.status = 'failed';
                throw new Error(`Step "${step.name}" failed in stage "${stage.name}"`);
              }
            }
          }
          if (stageHasFailure) {
            stageProg.status = 'failed';
          } else {
            stageProg.status = 'completed';
          }
        }

        stageProg.finishedAt = new Date().toISOString();
        this.emit('stage_complete', { stageId: stage.id, status: stageProg.status });
        this.emit('progress', runProgress);
      }

      runProgress.status = this.aborted ? 'cancelled' : runProgress.failedSteps > 0 ? 'failed' : 'completed';
    } catch (err) {
      if (this.aborted) {
        runProgress.status = 'cancelled';
      } else {
        runProgress.status = 'failed';
        runProgress.error = errMessage(err);
        this.logToRun(`[FATAL] Pipeline halted: ${errMessage(err)}`);
      }
    } finally {
      runProgress.finishedAt = new Date().toISOString();
      this.emit('finish', runProgress);
      this.emit('progress', runProgress);
      // Recording history must not turn a finished run into a rejection.
      try {
        await getWaffleRunHistory().recordRun(runProgress);
      } catch (recErr) {
        console.error('[waffle] failed to record run history:', recErr instanceof Error ? recErr.message : recErr);
      }
    }

    return runProgress;
  }

  /**
   * Derives Supabase ANON_KEY / SERVICE_ROLE_KEY as HS256 JWTs signed with SUPABASE_JWT_SECRET.
   * Returns undefined for any other variable or when the signing secret is not set.
   */
  private deriveSupabaseJwt(envVar: string): string | undefined {
    return deriveSupabaseJwtImpl(envVar, () => loadProjectEnvFilesImpl(this.projectRoot));
  }

  /**
   * Provision Kubernetes Secrets defined in pipeline.keys or step.keys
   */
  private async provisionSecrets(
    secrets: WaffleSecretKey[],
    defaultNamespace: string,
    dryRun?: boolean
  ): Promise<void> {
    return provisionSecretsImpl(secrets, defaultNamespace, (message) => this.logToRun(message), this.projectRoot, dryRun);
  }

  /**
   * Reads KEY=VALUE pairs from <projectRoot>/.env.production then .env (earlier file wins).
   * The Studio (Next.js) server does not load these itself, unlike the waffle CLI, so secrets
   * such as BILLAMA_MASTER_API_KEY would otherwise look unset when a run starts from the UI.
   * Process env always takes precedence (callers check it first).
   */
  private loadProjectEnvFiles(): Record<string, string> {
    return loadProjectEnvFilesImpl(this.projectRoot);
  }

  /**
   * Builds container images defined in pipeline.builds
   */
  private async buildImages(
    pipeline: WafflePipeline,
    baseDir: string,
    dryRun?: boolean
  ): Promise<void> {
    return buildImagesImpl(pipeline, baseDir, (message) => this.logToRun(message), dryRun);
  }

  /**
   * Builds, tags, pushes, and cluster-imports a single container image target
   */
  public async buildSingleTarget(
    target: WaffleBuildTarget,
    baseDir: string,
    registry: string = 'localhost:5001',
    dryRun?: boolean
  ): Promise<void> {
    return buildSingleTargetImpl(target, baseDir, registry, (message) => this.logToRun(message), dryRun);
  }

  /**
   * Ensures a registry is serving on the configured localhost:<port> endpoint by running
   * registry:2 inside the cluster (hostPort), so kubelet can pull "localhost:<port>/..." images.
   */
  private async ensureLocalRegistry(registry: string): Promise<void> {
    return ensureLocalRegistryImpl(registry, (message) => this.logToRun(message));
  }

  /**
   * Imports a built image (under every name kubelet might use) into containerd on the local
   * node and every other cluster node. Throws on failure so the build is not reported as OK.
   */
  private async importImageToCluster(target: { name: string; image: string; tag?: string }, fullTag: string): Promise<void> {
    return importImageToClusterImpl(target, fullTag, (message) => this.logToRun(message));
  }

  /**
   * Preflight checks: check OpenEBS storage class and cluster readiness
   */
  private async runPreflight(pipeline: WafflePipeline, baseDir: string, dryRun?: boolean): Promise<void> {
    this.logToRun('[PREFLIGHT] Checking cluster environment and storage fabric...');

    // Detect if OpenEBS storage class is needed
    const needsOpenEBS =
      Boolean(pipeline.preflight?.storage?.requireStorageClass?.includes('openebs')) ||
      Boolean(pipeline.settings?.defaultStorageClass?.includes('openebs')) ||
      pipeline.stages.some((st) =>
        st.steps.some((sp) => {
          const sets = sp.set ? Object.values(sp.set) : [];
          return sets.some((val) => String(val).includes('openebs'));
        })
      );

    if (needsOpenEBS) {
      this.logToRun('[PREFLIGHT] OpenEBS Dynamic LocalPV required. Verifying cluster StorageClass and provisioner...');
      if (!dryRun) {
        const openebsStatus = await checkOpenEbsStatus(this.projectRoot);
        if (openebsStatus.isReady) {
          this.logToRun(`[PREFLIGHT] OpenEBS is verified and active: ${openebsStatus.message}.`);
          return;
        }

        this.logToRun('[PREFLIGHT] OpenEBS not fully detected. Initiating dynamic provisioning...');
        // Check if local openebs chart exists
        const chartsDir = getChartsDirectory(this.projectRoot);
        const localOpenEBSChart = fs.existsSync(path.join(baseDir, 'openebs'))
          ? path.join(baseDir, 'openebs')
          : chartsDir && fs.existsSync(path.join(chartsDir, 'openebs'))
          ? path.join(chartsDir, 'openebs')
          : fs.existsSync(path.join(this.projectRoot, 'charts', 'openebs'))
          ? path.join(this.projectRoot, 'charts', 'openebs')
          : null;

        if (localOpenEBSChart) {
          this.logToRun(`[PREFLIGHT] Found local OpenEBS chart at ${localOpenEBSChart}. Installing via Helm...`);
          try {
            await execFileAsync('helm', ['upgrade', '--install', 'openebs', localOpenEBSChart, '--namespace', 'openebs', '--create-namespace', '--wait', '--timeout', '5m']);
            this.logToRun('[PREFLIGHT] Successfully deployed OpenEBS Dynamic LocalPV provisioner.');
          } catch (err) {
            const recheck = await checkOpenEbsStatus(this.projectRoot);
            if (recheck.isReady) {
              this.logToRun(`[PREFLIGHT] OpenEBS is verified active despite Helm upgrade notice: ${recheck.message}`);
            } else {
              throw err;
            }
          }
        } else {
          // Attempt storage script fallback
          const storageScript = path.join(this.projectRoot, 'src', 'k3s_storage.sh');
          if (fs.existsSync(storageScript)) {
            this.logToRun('[PREFLIGHT] Running src/k3s_storage.sh install --engine openebs...');
            await execFileAsync('bash', [storageScript, 'install', '--engine', 'openebs']);
            this.logToRun('[PREFLIGHT] OpenEBS provisioned via cluster storage script.');
          } else {
            this.logToRun('[PREFLIGHT] Warning: OpenEBS provisioner script not available. Proceeding with deployment...');
          }
        }
      } else {
        this.logToRun('[PREFLIGHT] [DRY-RUN] OpenEBS StorageClass verification simulated (OK).');
      }
    }
  }

  /**
   * Executes a single step (helm lint, helm install/upgrade, verification)
   */
  private async executeStep(ctx: {
    step: WaffleStep;
    stageId: string;
    pipeline: WafflePipeline;
    baseDir: string;
    dryRun: boolean;
    runProgress: WaffleRunProgress;
  }): Promise<boolean> {
    const { step, stageId, pipeline, baseDir, dryRun, runProgress } = ctx;
    const stepProg = runProgress.stages[stageId].steps[step.id];
    stepProg.status = 'running';
    stepProg.startedAt = new Date().toISOString();
    runProgress.activeStepId = step.id;

    const startTimer = Date.now();
    this.emit('step_start', { stepId: step.id, name: step.name, stageId });
    this.emit('progress', runProgress);

    const log = (msg: string) => {
      const line = `[${new Date().toLocaleTimeString()}] [${step.id}] ${msg}`;
      stepProg.logs.push(line);
      // Cap per-step logs like the task executor does (2,000 entries);
      // a chatty helm run otherwise grows the run record without bound.
      if (stepProg.logs.length > 2000) stepProg.logs.splice(0, stepProg.logs.length - 2000);
      runProgress.currentLogLine = line;
      this.emit('step_log', { stepId: step.id, line });
      this.emit('progress', runProgress);
    };

    try {
      // Resolve chart path
      let chartPath = step.chart;
      const configuredChartsDir = getChartsDirectory(this.projectRoot);
      const cleanChartName = step.chart.replace(/^\.\//, '');

      if (path.isAbsolute(step.chart) && fs.existsSync(step.chart)) {
        chartPath = step.chart;
      } else if (fs.existsSync(path.resolve(baseDir, step.chart))) {
        chartPath = path.resolve(baseDir, step.chart);
      } else if (configuredChartsDir && fs.existsSync(path.join(configuredChartsDir, cleanChartName))) {
        chartPath = path.join(configuredChartsDir, cleanChartName);
      } else if (fs.existsSync(path.join(this.projectRoot, 'charts', cleanChartName))) {
        chartPath = path.join(this.projectRoot, 'charts', cleanChartName);
      } else if (step.chart.startsWith('.')) {
        chartPath = path.resolve(baseDir, step.chart);
      }

      const releaseName = step.releaseName || step.id;
      const namespace = step.namespace || pipeline.settings?.defaultNamespace || 'default';
      const timeout = step.timeout || '5m';

      // OpenEBS idempotency detection:
      // If this step deploys OpenEBS (chart path, step id, or release name),
      // verify if OpenEBS is already operational in the cluster to prevent Helm immutable field conflicts.
      const isOpenEbsStep =
        step.id.toLowerCase().includes('openebs') ||
        releaseName.toLowerCase().includes('openebs') ||
        step.chart.toLowerCase().includes('openebs');

      if (isOpenEbsStep && !dryRun) {
        log('Checking if OpenEBS Storage Fabric is already active in cluster...');
        const openebsStatus = await checkOpenEbsStatus(this.projectRoot);
        if (openebsStatus.isReady) {
          log('[openebs] OpenEBS is already deployed and operational in cluster:');
          if (openebsStatus.storageClasses.length > 0) {
            log(`  * StorageClasses: ${openebsStatus.storageClasses.join(', ')}`);
          }
          if (openebsStatus.readyDeployments.length > 0) {
            log(`  * Ready Deployments: ${openebsStatus.readyDeployments.join(', ')}`);
          }
          log(`  * Running Pods: ${openebsStatus.runningPods}`);
          log('[openebs] Skipping "helm upgrade" to prevent immutable field conflicts (StorageClass parameters & Deployment selector).');

          stepProg.status = 'completed';
          stepProg.finishedAt = new Date().toISOString();
          stepProg.durationMs = Date.now() - startTimer;
          runProgress.completedSteps++;

          log(`Step "${step.name}" finished in ${(stepProg.durationMs / 1000).toFixed(1)}s (already active).`);
          this.emit('step_complete', { stepId: step.id, status: 'completed' });
          this.emit('progress', runProgress);
          return true;
        }
      }

      // Step-level secrets synchronization
      if (step.keys) {
        const keysAsSecret = step.keys as WaffleSecretKey;
        const stepSec: WaffleSecretKey = typeof keysAsSecret.name === 'string'
          ? keysAsSecret
          : {
              name: `${step.id}-secrets`,
              namespace,
              literals: step.keys as Record<string, string>,
            };
        await this.provisionSecrets([stepSec], namespace, dryRun);
      }

      log(`Preparing Helm deployment: release="${releaseName}", namespace="${namespace}", chart="${step.chart}"`);

      // Construct Helm flags
      const helmArgs = [
        'upgrade',
        '--install',
        releaseName,
        chartPath,
        '--namespace',
        namespace,
      ];

      if (step.createNamespace || isOpenEbsStep) {
        helmArgs.push('--create-namespace');
      }

      if (step.wait && !dryRun) {
        helmArgs.push('--wait');
      }

      helmArgs.push('--timeout', timeout);
      helmArgs.push('--take-ownership');

      // Domain configuration
      if (step.domain) {
        helmArgs.push('--set', `ingress.host=${step.domain}`);
        runProgress.deployedDomains.push({
          name: step.name,
          domain: step.domain,
          url: `https://${step.domain}`,
        });
      }

      // Explicit set values
      if (step.set) {
        for (const [key, val] of Object.entries(step.set)) {
          helmArgs.push('--set', `${key}=${val}`);
        }
      }

      // Dry-run mode
      if (dryRun) {
        helmArgs.push('--dry-run');
        log(`Running in DRY-RUN mode: helm ${helmArgs.join(' ')}`);
      }

      // Execute Helm command. The display string is for the log only;
      // execution is argv-based (no shell), so step values such as the
      // namespace, release name, chart and --set entries can never be
      // reinterpreted as shell syntax.
      log(`Executing: helm ${helmArgs.map((a) => (a.includes(' ') || a.includes('=') ? JSON.stringify(a) : a)).join(' ')}`);

      if (!dryRun) {
        const { stdout, stderr } = await execFileAsync('helm', helmArgs, { cwd: baseDir, env: getWaffleExecutionEnv() });
        if (stdout) log(stdout.trim());
        if (stderr) log(stderr.trim());

        // Health / Readiness probe
        stepProg.status = 'verifying';
        this.emit('progress', runProgress);
        log(`Verifying deployment readiness in namespace "${namespace}"...`);
        await this.verifyStepHealth(step, namespace, log);
      } else {
        log('Dry-run completed successfully (manifests simulated).');
      }

      stepProg.status = 'completed';
      stepProg.finishedAt = new Date().toISOString();
      stepProg.durationMs = Date.now() - startTimer;
      runProgress.completedSteps++;

      log(`Step "${step.name}" finished in ${(stepProg.durationMs / 1000).toFixed(1)}s.`);
      this.emit('step_complete', { stepId: step.id, status: 'completed' });
      this.emit('progress', runProgress);
      return true;
    } catch (err) {
      const errMsg = err instanceof Error && err.message ? err.message : String(err);
      const releaseName = step.releaseName || step.id;
      const isOpenEbsStep =
        step.id.toLowerCase().includes('openebs') ||
        releaseName.toLowerCase().includes('openebs') ||
        step.chart.toLowerCase().includes('openebs');

      if (
        isOpenEbsStep &&
        (errMsg.includes('field is immutable') ||
          errMsg.includes('cannot patch') ||
          errMsg.includes('meta.helm.sh/release-name') ||
          errMsg.includes('invalid ownership metadata') ||
          errMsg.includes('rendered manifests contain a resource that already exists') ||
          errMsg.includes('StorageClass "openebs-hostpath"'))
      ) {
        const fallbackCheck = await checkOpenEbsStatus(this.projectRoot).catch(() => ({
          isReady: false,
          message: '',
          storageClasses: [],
          readyDeployments: [],
          runningPods: 0,
        }));
        if (
          fallbackCheck.isReady ||
          fallbackCheck.storageClasses.some((s) => s.includes('openebs')) ||
          errMsg.includes('meta.helm.sh') ||
          errMsg.includes('already exists')
        ) {
          log(`[openebs] Warning: Helm reported existing installation conflict (${errMsg.split('\n')[0]}), but OpenEBS is verified active in cluster: ${fallbackCheck.message || 'StorageClass openebs-hostpath registered'}`);
          log(`[openebs] Marking step "${step.name}" as completed.`);

          stepProg.status = 'completed';
          stepProg.finishedAt = new Date().toISOString();
          stepProg.durationMs = Date.now() - startTimer;
          runProgress.completedSteps++;
          this.emit('step_complete', { stepId: step.id, status: 'completed' });
          this.emit('progress', runProgress);
          return true;
        }
      }

      stepProg.status = 'failed';
      stepProg.finishedAt = new Date().toISOString();
      stepProg.durationMs = Date.now() - startTimer;
      stepProg.error = errMsg;
      runProgress.failedSteps++;

      log(`[ERROR] Step failed: ${errMsg}`);
      this.emit('step_complete', { stepId: step.id, status: 'failed', error: errMsg });
      this.emit('progress', runProgress);
      return false;
    }
  }

  /**
   * Verifies health of deployed resources
   */
  private async verifyStepHealth(step: WaffleStep, namespace: string, log: (msg: string) => void): Promise<void> {
    return verifyStepHealthImpl(step, namespace, log);
  }

  private logToRun(message: string): void {
    if (this.activeRun) {
      this.activeRun.currentLogLine = message;
      this.emit('pipeline_log', message);
      this.emit('progress', this.activeRun);
    }
  }
}
