/**
 * Waffle Watcher & Automated Rebuilder.
 * Monitors application repositories for code/git updates, synchronizes Helm chart templates,
 * rebuilds container images, publishes/imports them to cluster containerd, and triggers rollouts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { execAsync, getWaffleExecutionEnv } from './shared.js';
import {
  loadWafflePipeline,
  type WafflePipeline,
  type WaffleBuildTarget,
  type WaffleStep,
} from './schema.js';
import { WaffleRunner } from './runner.js';
import { getChartsDirectory } from '../config.js';

export interface WaffleWatchTarget {
  name: string;
  context: string;
  gitRepo?: string;
  gitBranch?: string;
  image: string;
  tag: string;
  dockerfile?: string;
  chartPath?: string;
  chartName?: string;
  repoChartPath?: string;
  releaseName?: string;
  namespace?: string;
  lastSha?: string;
  lastMtime?: number;
}

export interface WaffleWatcherOptions {
  projectRoot?: string;
  pipelinePath?: string;
  intervalMs?: number;
  fetchRemote?: boolean;
  autoDeploy?: boolean;
  rebuildUmbrella?: boolean;
  dryRun?: boolean;
  targets?: string[];
  syncCharts?: boolean;
  logger?: (msg: string) => void;
}

export interface WaffleRebuildResult {
  target: string;
  image: string;
  durationMs: number;
  chartSynced?: boolean;
  deployed?: boolean;
  releaseName?: string;
  namespace?: string;
  error?: string;
}

export interface WaffleWatchCheckResult {
  timestamp: string;
  targetsChecked: number;
  changesDetected: number;
  rebuilds: WaffleRebuildResult[];
}

export class WaffleWatcher extends EventEmitter {
  private projectRoot: string;
  private pipelinePath?: string;
  private intervalMs: number;
  private fetchRemote: boolean;
  private autoDeploy: boolean;
  private rebuildUmbrella: boolean;
  private dryRun: boolean;
  private targetFilter?: Set<string>;
  private syncCharts: boolean;
  private logger: (msg: string) => void;

  private targets: Map<string, WaffleWatchTarget> = new Map();
  private baseDir: string = process.cwd();
  private pipeline: WafflePipeline | null = null;
  private runner: WaffleRunner;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;

  constructor(options: WaffleWatcherOptions = {}) {
    super();
    this.projectRoot = options.projectRoot || process.cwd();
    this.pipelinePath = options.pipelinePath;
    this.intervalMs = Math.max(1000, options.intervalMs ?? 5000);
    this.fetchRemote = Boolean(options.fetchRemote);
    this.autoDeploy = options.autoDeploy !== false;
    this.rebuildUmbrella = Boolean(options.rebuildUmbrella);
    this.dryRun = Boolean(options.dryRun);
    this.syncCharts = options.syncCharts !== false;
    this.logger = options.logger || ((msg: string) => console.log(msg));

    if (options.targets && options.targets.length > 0) {
      this.targetFilter = new Set(options.targets.map((t) => t.trim().toLowerCase()));
    }

    this.runner = new WaffleRunner(this.projectRoot);
  }

  /**
   * Initializes the pipeline targets, resolves paths, and captures baseline Git SHAs / timestamps.
   */
  public async init(): Promise<void> {
    const chartsDir = getChartsDirectory(this.projectRoot);
    const candidatePaths = [
      this.pipelinePath,
      path.join(this.projectRoot, 'charts', 'waffle.yaml'),
      chartsDir ? path.join(chartsDir, 'waffle.yaml') : null,
      path.join(this.projectRoot, 'waffle.yaml'),
      '/root/charts/waffle.yaml',
    ].filter(Boolean) as string[];

    let resolvedPipelineFile: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        resolvedPipelineFile = path.resolve(p);
        break;
      }
    }

    if (!resolvedPipelineFile) {
      throw new Error(`Unable to locate waffle.yaml in candidate locations: ${candidatePaths.join(', ')}`);
    }

    this.baseDir = path.dirname(resolvedPipelineFile);
    this.runner = new WaffleRunner(this.baseDir);

    const { pipeline } = await loadWafflePipeline(resolvedPipelineFile);
    this.pipeline = pipeline;

    if (!pipeline.builds?.targets || pipeline.builds.targets.length === 0) {
      this.log(`[WATCHER] Notice: No build targets found in ${resolvedPipelineFile}`);
      return;
    }

    // Index steps by target name or chart to know what to deploy
    const stepsMap = new Map<string, WaffleStep>();
    for (const stage of pipeline.stages || []) {
      for (const step of stage.steps || []) {
        stepsMap.set(step.id.toLowerCase(), step);
        const chartName = path.basename(step.chart).toLowerCase();
        stepsMap.set(chartName, step);
        if (step.releaseName) stepsMap.set(step.releaseName.toLowerCase(), step);
      }
    }

    this.targets.clear();

    for (const target of pipeline.builds.targets) {
      if (this.targetFilter && !this.targetFilter.has(target.name.toLowerCase())) {
        continue;
      }

      const contextPath = path.resolve(this.baseDir, target.context);
      const gitRepo = typeof target.git === 'string' ? target.git : target.git?.repo;
      const gitBranch = typeof target.git === 'object' ? target.git?.branch : 'main';

      // Find matching pipeline step
      const matchedStep =
        stepsMap.get(target.name.toLowerCase()) ||
        stepsMap.get(target.image.split('/')[0].toLowerCase()) ||
        stepsMap.get(path.basename(target.image).toLowerCase());

      // Resolve chart directory in charts/
      let chartPath: string | undefined;
      const cleanChartName = matchedStep?.chart
        ? path.basename(matchedStep.chart)
        : target.name;
      const candidates = [
        matchedStep?.chart ? path.resolve(this.baseDir, matchedStep.chart) : null,
        path.join(this.baseDir, cleanChartName),
        chartsDir ? path.join(chartsDir, cleanChartName) : null,
        path.join(this.projectRoot, 'charts', cleanChartName),
        path.join('/root/charts', cleanChartName),
      ].filter(Boolean) as string[];

      for (const c of candidates) {
        if (fs.existsSync(c) && (fs.existsSync(path.join(c, 'Chart.yaml')) || fs.existsSync(path.join(c, 'Chart.yml')))) {
          chartPath = c;
          break;
        }
      }
      if (!chartPath) {
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            chartPath = c;
            break;
          }
        }
      }
      if (!chartPath) {
        chartPath = matchedStep?.chart
          ? path.resolve(this.baseDir, matchedStep.chart)
          : path.join(this.projectRoot, 'charts', cleanChartName);
      }

      // Check if the repo has its own internal helm/ chart directory
      let repoChartPath: string | undefined;
      const repoHelmCandidates = [
        path.join(contextPath, 'helm', cleanChartName),
        path.join(contextPath, 'helm', target.name),
        path.join(contextPath, 'helm'),
        path.join(contextPath, 'apps', 'saas', 'helm'),
      ];
      for (const r of repoHelmCandidates) {
        if (fs.existsSync(r) && (fs.existsSync(path.join(r, 'Chart.yaml')) || fs.existsSync(path.join(r, 'Chart.yml')))) {
          repoChartPath = r;
          break;
        }
      }

      // If still not found, check subdirectories inside contextPath/helm/
      const helmDir = path.join(contextPath, 'helm');
      if (!repoChartPath && fs.existsSync(helmDir)) {
        try {
          const subdirs = fs.readdirSync(helmDir, { withFileTypes: true });
          for (const d of subdirs) {
            if (d.isDirectory()) {
              const subPath = path.join(helmDir, d.name);
              if (fs.existsSync(path.join(subPath, 'Chart.yaml')) || fs.existsSync(path.join(subPath, 'Chart.yml'))) {
                repoChartPath = subPath;
                break;
              }
            }
          }
        } catch {
          // ignore read error
        }
      }

      // Baseline SHA and mtime
      const lastSha = await this.getGitSha(contextPath);
      const lastMtime = await this.getDirectoryMtime(contextPath);

      const watchTarget: WaffleWatchTarget = {
        name: target.name,
        context: contextPath,
        gitRepo,
        gitBranch,
        image: target.image,
        tag: target.tag || 'latest',
        dockerfile: target.dockerfile,
        chartPath,
        chartName: chartPath ? path.basename(chartPath) : cleanChartName,
        repoChartPath,
        releaseName: matchedStep?.releaseName || target.name,
        namespace: matchedStep?.namespace || pipeline.settings?.defaultNamespace || 'default',
        lastSha,
        lastMtime,
      };

      this.targets.set(target.name, watchTarget);
    }

    this.log(
      `[WATCHER] Initialized watcher for ${this.targets.size} target(s) using pipeline "${pipeline.metadata.name}" in ${this.baseDir}`
    );
    for (const t of this.targets.values()) {
      this.log(`  • [${t.name}] context=${t.context} sha=${t.lastSha?.substring(0, 7) || 'n/a'} chart=${t.chartPath || 'none'}`);
    }

    this.emit('ready', {
      pipelineName: pipeline.metadata.name,
      targetsCount: this.targets.size,
      targets: Array.from(this.targets.values()),
    });
  }

  /**
   * Returns whether the watcher daemon is currently active.
   */
  public isRunning(): boolean {
    return this.intervalHandle !== null;
  }

  /**
   * Retrieves the current list of monitored targets.
   */
  public getTargets(): WaffleWatchTarget[] {
    return Array.from(this.targets.values());
  }

  /**
   * Retrieves a target by name.
   */
  public getTarget(name: string): WaffleWatchTarget | undefined {
    return this.targets.get(name);
  }

  /**
   * Checks whether a target exists.
   */
  public hasTarget(name: string): boolean {
    return this.targets.has(name);
  }

  /**
   * Synchronizes templates from target's repoChartPath to chartPath.
   */
  public async syncRepoChartToCentral(target: WaffleWatchTarget): Promise<boolean> {
    if (!target.repoChartPath || !target.chartPath) return false;
    return this.syncChartDirectory(target.repoChartPath, target.chartPath);
  }

  /**
   * Performs a single check across all tracked repositories.
   */
  public async checkOnce(): Promise<WaffleWatchCheckResult> {
    if (!this.pipeline) {
      await this.init();
    }

    const timestamp = new Date().toISOString();
    const rebuilds: WaffleRebuildResult[] = [];
    let changesDetected = 0;

    for (const target of this.targets.values()) {
      try {
        const changeInfo = await this.inspectTarget(target);
        if (changeInfo.hasChanged) {
          changesDetected++;
          this.log(
            `[WATCHER] Change detected in target "${target.name}": ${changeInfo.reason} (previous: ${target.lastSha?.substring(0, 7) || 'init'}, current: ${changeInfo.newSha?.substring(0, 7) || 'modified'})`
          );
          this.emit('change_detected', {
            target: target.name,
            reason: changeInfo.reason,
            oldSha: target.lastSha,
            newSha: changeInfo.newSha,
          });

          // Rebuild
          const result = await this.rebuildTarget(target.name, changeInfo.reason);
          rebuilds.push(result);

          // Update recorded state
          target.lastSha = changeInfo.newSha || target.lastSha;
          target.lastMtime = changeInfo.newMtime || target.lastMtime;
        }
      } catch (err: any) {
        this.log(`[WATCHER] Error inspecting target "${target.name}": ${err.message}`);
        this.emit('error', { target: target.name, error: err.message });
      }
    }

    // If any rebuild occurred and umbrella rebuilding is requested
    if (rebuilds.length > 0 && this.rebuildUmbrella && !this.dryRun) {
      await this.updateUmbrellaChart();
    }

    return {
      timestamp,
      targetsChecked: this.targets.size,
      changesDetected,
      rebuilds,
    };
  }

  /**
   * Inspects a single target to see if its commit SHA or files changed.
   */
  private async inspectTarget(
    target: WaffleWatchTarget
  ): Promise<{ hasChanged: boolean; reason: string; newSha?: string; newMtime?: number }> {
    if (!fs.existsSync(target.context)) {
      return { hasChanged: false, reason: 'directory not found' };
    }

    const isGit = fs.existsSync(path.join(target.context, '.git'));

    if (isGit) {
      if (this.fetchRemote && !this.dryRun) {
        try {
          await execAsync('git fetch --depth 1', { cwd: target.context, timeout: 10000 });
        } catch {
          // Ignore transient network/git fetch errors
        }
      }

      const currentSha = await this.getGitSha(target.context);
      if (currentSha && target.lastSha && currentSha !== target.lastSha) {
        return {
          hasChanged: true,
          reason: `Git commit changed: ${target.lastSha.substring(0, 7)} -> ${currentSha.substring(0, 7)}`,
          newSha: currentSha,
        };
      }

      // Check for uncommitted working tree modifications
      const { stdout: statusOut } = await execAsync('git status --porcelain', {
        cwd: target.context,
      }).catch(() => ({ stdout: '' }));

      const currentMtime = await this.getDirectoryMtime(target.context);
      if (statusOut.trim().length > 0 && target.lastMtime && currentMtime > target.lastMtime + 1000) {
        return {
          hasChanged: true,
          reason: `Working tree uncommitted changes detected (${statusOut.trim().split('\n').length} files modified)`,
          newSha: currentSha,
          newMtime: currentMtime,
        };
      }

      return { hasChanged: false, reason: 'no changes', newSha: currentSha, newMtime: currentMtime };
    }

    // Fallback: directory mtime check
    const currentMtime = await this.getDirectoryMtime(target.context);
    if (target.lastMtime && currentMtime > target.lastMtime + 1000) {
      return {
        hasChanged: true,
        reason: 'Directory timestamp changed',
        newMtime: currentMtime,
      };
    }

    return { hasChanged: false, reason: 'no changes', newMtime: currentMtime };
  }

  /**
   * Rebuilds a specific target: synchronizes chart, builds container image, imports to cluster, and triggers rollout.
   */
  public async rebuildTarget(targetName: string, reason: string = 'manual trigger'): Promise<WaffleRebuildResult> {
    const target = this.targets.get(targetName);
    if (!target) {
      throw new Error(`Target "${targetName}" is not registered in WaffleWatcher`);
    }

    const start = Date.now();
    const registry = this.pipeline?.builds?.registry || 'localhost:5001';
    let chartSynced = false;
    let deployed = false;

    this.log(`[WATCHER] === Starting Automated Rebuild: ${target.name} (${reason}) ===`);
    this.emit('build_start', { target: target.name, image: `${registry}/${target.image}:${target.tag}` });

    try {
      // 1. Sync Helm chart if the repo contains its own helm/ directory
      if (this.syncCharts && target.repoChartPath && target.chartPath && !this.dryRun) {
        chartSynced = await this.syncChartDirectory(target.repoChartPath, target.chartPath);
        if (chartSynced) {
          this.log(`[WATCHER] [${target.name}] Synchronized chart templates from ${target.repoChartPath} -> ${target.chartPath}`);
          this.emit('chart_synced', { target: target.name, from: target.repoChartPath, to: target.chartPath });
        }
      }

      // 2. Build and import image using WaffleRunner
      const rawTarget: WaffleBuildTarget = {
        name: target.name,
        context: path.relative(this.baseDir, target.context) || '.',
        image: target.image,
        tag: target.tag,
        dockerfile: target.dockerfile,
      };

      await this.runner.buildSingleTarget(rawTarget, this.baseDir, registry, this.dryRun);
      const durationMs = Date.now() - start;
      this.log(`[WATCHER] [${target.name}] Image build and cluster containerd import complete in ${(durationMs / 1000).toFixed(1)}s.`);
      this.emit('build_complete', { target: target.name, image: `${registry}/${target.image}:${target.tag}`, durationMs });

      // 3. Rollout / Deploy to cluster
      if (this.autoDeploy && !this.dryRun && target.releaseName && target.namespace) {
        deployed = await this.rolloutTarget(target);
      }

      return {
        target: target.name,
        image: `${registry}/${target.image}:${target.tag}`,
        durationMs,
        chartSynced,
        deployed,
        releaseName: target.releaseName,
        namespace: target.namespace,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      this.log(`[WATCHER] [${target.name}] ERROR during rebuild: ${err.message}`);
      this.emit('error', { target: target.name, error: err.message });
      return {
        target: target.name,
        image: `${registry}/${target.image}:${target.tag}`,
        durationMs,
        chartSynced,
        deployed: false,
        error: err.message,
      };
    }
  }

  /**
   * Synchronizes template files from repo chart dir to central charts dir if newer.
   */
  public async syncChartDirectory(sourceDir: string, destDir: string): Promise<boolean> {
    if (!fs.existsSync(sourceDir)) return false;
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let modified = false;
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const srcPath = path.join(sourceDir, entry.name);
      const dstPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        if (!fs.existsSync(dstPath)) {
          fs.mkdirSync(dstPath, { recursive: true });
        }
        const subMod = await this.syncChartDirectory(srcPath, dstPath);
        if (subMod) modified = true;
      } else {
        // Skip overwriting production values.yaml if destination already has customized values
        if (entry.name === 'values.yaml' && fs.existsSync(dstPath)) {
          continue;
        }

        const srcStat = fs.statSync(srcPath);
        const dstExists = fs.existsSync(dstPath);
        const dstStat = dstExists ? fs.statSync(dstPath) : null;

        let shouldCopy = !dstStat || srcStat.mtimeMs > dstStat.mtimeMs || srcStat.size !== dstStat.size;
        if (!shouldCopy && dstExists) {
          const srcBuf = fs.readFileSync(srcPath);
          const dstBuf = fs.readFileSync(dstPath);
          if (!srcBuf.equals(dstBuf)) {
            shouldCopy = true;
          }
        }

        if (shouldCopy) {
          fs.copyFileSync(srcPath, dstPath);
          modified = true;
        }
      }
    }

    return modified;
  }

  /**
   * Triggers a rollout restart for the target deployment so pods load the newly built image.
   */
  private async rolloutTarget(target: WaffleWatchTarget): Promise<boolean> {
    const env = getWaffleExecutionEnv();
    const ns = target.namespace || 'default';
    const release = target.releaseName || target.name;

    this.log(`[WATCHER] [${target.name}] Triggering cluster rollout for release "${release}" in namespace "${ns}"...`);
    this.emit('deploy_start', { target: target.name, release, namespace: ns });

    try {
      // Find candidate deployment name
      const { stdout } = await execAsync(
        `kubectl get deployments -n ${JSON.stringify(ns)} -o jsonpath='{.items[*].metadata.name}'`,
        { env }
      ).catch(() => ({ stdout: '' }));

      const deployments = stdout.split(/\s+/).filter(Boolean);
      const matched = deployments.find(
        (d) => d === release || d === target.name || d.includes(target.name) || d.includes(release)
      );

      if (matched) {
        await execAsync(`kubectl rollout restart deployment/${matched} -n ${JSON.stringify(ns)}`, { env });
        this.log(`[WATCHER] [${target.name}] Dispatched rollout restart for deployment "${matched}". Waiting for status...`);
        await execAsync(`kubectl rollout status deployment/${matched} -n ${JSON.stringify(ns)} --timeout=90s`, { env });
        this.log(`[WATCHER] [${target.name}] Deployment "${matched}" successfully rolled out.`);
        this.emit('deploy_complete', { target: target.name, release: matched, namespace: ns, status: 'rolled_out' });
        return true;
      } else {
        this.log(`[WATCHER] [${target.name}] Notice: No active deployment matched "${release}" in namespace "${ns}".`);
        return false;
      }
    } catch (err: any) {
      this.log(`[WATCHER] [${target.name}] Rollout notice: ${err.message}`);
      return false;
    }
  }

  /**
   * Updates dependencies for the umbrella ecosystem chart if it exists.
   */
  private async updateUmbrellaChart(): Promise<void> {
    const ecosystemDir = path.join(this.baseDir, 'ecosystem');
    if (fs.existsSync(ecosystemDir) && fs.existsSync(path.join(ecosystemDir, 'Chart.yaml'))) {
      try {
        this.log('[WATCHER] Rebuilding umbrella chart dependencies: helm dependency update ./ecosystem...');
        await execAsync('helm dependency update ./ecosystem', { cwd: this.baseDir });
        this.log('[WATCHER] Umbrella ecosystem dependencies updated.');
      } catch (err: any) {
        this.log(`[WATCHER] Warning: Umbrella dependency update failed: ${err.message}`);
      }
    }
  }

  /**
   * Starts the continuous background polling loop.
   */
  public start(): void {
    if (this.intervalHandle) return;

    this.log(`[WATCHER] Starting continuous repository watch daemon (interval: ${this.intervalMs}ms)...`);
    this.intervalHandle = setInterval(async () => {
      if (this.isChecking) return;
      this.isChecking = true;
      try {
        await this.checkOnce();
      } catch (err: any) {
        this.log(`[WATCHER] Polling cycle error: ${err.message}`);
      } finally {
        this.isChecking = false;
      }
    }, this.intervalMs);
  }

  /**
   * Stops the watch daemon.
   */
  public stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.log('[WATCHER] Watch daemon stopped.');
      this.emit('stopped');
    }
  }

  private async getGitSha(dir: string): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: dir });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  private async getDirectoryMtime(dir: string): Promise<number> {
    try {
      const stat = fs.statSync(dir);
      return stat.mtimeMs;
    } catch {
      return 0;
    }
  }

  private log(msg: string): void {
    this.logger(msg);
  }
}
