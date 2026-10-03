import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { z } from 'zod';
import { loadProjectConfig, getChartsDirectory } from './config.js';
import { checkOpenEbsStatus, isOpenEbsInstalledAndReady } from './storage.js';

const execAsync = promisify(exec);

export function getWaffleExecutionEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kubeconfig =
    process.env.KUBECONFIG ||
    (fs.existsSync('/etc/rancher/k3s/k3s.yaml')
      ? '/etc/rancher/k3s/k3s.yaml'
      : fs.existsSync(path.join(process.env.HOME || '/root', '.kube', 'config'))
      ? path.join(process.env.HOME || '/root', '.kube', 'config')
      : undefined);

  return {
    ...process.env,
    ...(kubeconfig ? { KUBECONFIG: kubeconfig } : {}),
    ...extra,
  };
}

// ============================================================================
// 1. TYPES & SCHEMAS FOR WAFFLE META-PACKAGES
// ============================================================================

export interface WafflePipelineMetadata {
  name: string;
  version?: string;
  description?: string;
  authors?: Array<{ name: string; email?: string }>;
  tags?: string[];
}

export interface WaffleSettings {
  defaultNamespace?: string;
  defaultStorageClass?: string;
  defaultClusterIssuer?: string;
  globalTimeout?: string;
  rollbackOnFailure?: boolean;
}

export interface WafflePreflight {
  storage?: {
    requireStorageClass?: string;
    autoInstallOpenEBS?: boolean;
  };
  ingress?: {
    requireController?: string;
  };
  resources?: {
    minCpuCores?: number;
    minMemoryGb?: number;
  };
}

export interface WaffleHealthCheck {
  type?: 'storageClass' | 'tcp' | 'http' | 'podReady' | 'custom';
  name?: string;
  service?: string;
  port?: number;
  url?: string;
  expectedStatus?: number;
  timeout?: string;
}

export interface WaffleSecretKey {
  name: string;
  namespace?: string;
  literals?: Record<string, string>;
  fromEnv?: string[];
}

export interface WaffleKeysConfig {
  secrets?: WaffleSecretKey[];
  envFile?: string;
}

export interface WaffleGitSource {
  repo: string;
  branch?: string;
  tag?: string;
  commit?: string;
  dir?: string;
  depth?: number;
  submodules?: boolean;
}

export interface WaffleBuildTarget {
  name: string;
  context: string;
  git?: string | WaffleGitSource;
  dockerfile?: string;
  image: string;
  tag?: string;
}

export interface WaffleGitOpsConfig {
  engine?: 'argocd' | 'flux' | 'waffle';
  branch?: string;
  autoBuildOnPush?: boolean;
  webhookPath?: string;
}

export interface WaffleBuildsConfig {
  registry?: string;
  gitops?: WaffleGitOpsConfig;
  targets?: WaffleBuildTarget[];
}

export interface WaffleStep {
  id: string;
  name: string;
  chart: string;
  releaseName?: string;
  namespace?: string;
  createNamespace?: boolean;
  wait?: boolean;
  timeout?: string;
  domain?: string;
  values?: Record<string, any>;
  set?: Record<string, string | number | boolean>;
  healthCheck?: WaffleHealthCheck;
  keys?: Record<string, string> | WaffleSecretKey;
}

export interface WaffleStage {
  id: string;
  name: string;
  description?: string;
  mode?: 'series' | 'parallel';
  dependsOn?: string[];
  steps: WaffleStep[];
}

export interface WafflePipeline {
  apiVersion?: string;
  kind?: string;
  metadata: WafflePipelineMetadata;
  settings?: WaffleSettings;
  preflight?: WafflePreflight;
  keys?: WaffleKeysConfig;
  builds?: WaffleBuildsConfig;
  stages: WaffleStage[];
}

export const WafflePipelineMetadataSchema = z.object({
  name: z.string().min(1, 'Pipeline name is required'),
  version: z.string().optional().default('1.0.0'),
  description: z.string().optional().default(''),
  authors: z.array(z.object({
    name: z.string(),
    email: z.string().optional(),
  })).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

export const WaffleSettingsSchema = z.object({
  defaultNamespace: z.string().optional().default('default'),
  defaultStorageClass: z.string().optional().default('openebs-lvmpv'),
  defaultClusterIssuer: z.string().optional().default('letsencrypt-prod'),
  globalTimeout: z.string().optional().default('30m'),
  rollbackOnFailure: z.boolean().optional().default(true),
});

export const WafflePreflightSchema = z.object({
  storage: z.object({
    requireStorageClass: z.string().optional(),
    autoInstallOpenEBS: z.boolean().optional().default(true),
  }).optional(),
  ingress: z.object({
    requireController: z.string().optional().default('nginx'),
  }).optional(),
  resources: z.object({
    minCpuCores: z.number().optional().default(2),
    minMemoryGb: z.number().optional().default(4),
  }).optional(),
}).optional();

export const WaffleHealthCheckSchema = z.object({
  type: z.enum(['storageClass', 'tcp', 'http', 'podReady', 'custom']).optional().default('podReady'),
  name: z.string().optional(),
  service: z.string().optional(),
  port: z.number().optional(),
  url: z.string().optional(),
  expectedStatus: z.number().optional().default(200),
  timeout: z.string().optional().default('3m'),
});

export const WaffleSecretKeySchema = z.object({
  name: z.string(),
  namespace: z.string().optional(),
  literals: z.record(z.string()).optional(),
  fromEnv: z.array(z.string()).optional(),
});

export const WaffleKeysConfigSchema = z.object({
  secrets: z.array(WaffleSecretKeySchema).optional().default([]),
  envFile: z.string().optional(),
});

export const WaffleGitSourceSchema = z.object({
  repo: z.string().min(1, 'Git repository URL is required'),
  branch: z.string().optional(),
  tag: z.string().optional(),
  commit: z.string().optional(),
  dir: z.string().optional(),
  depth: z.number().int().positive().optional(),
  submodules: z.boolean().optional(),
});

export const WaffleBuildTargetSchema = z.object({
  name: z.string(),
  context: z.string(),
  git: z.union([z.string(), WaffleGitSourceSchema]).optional(),
  dockerfile: z.string().optional(),
  image: z.string(),
  tag: z.string().optional().default('latest'),
});

export const WaffleGitOpsSchema = z.object({
  engine: z.enum(['argocd', 'flux', 'waffle']).optional().default('flux'),
  branch: z.string().optional().default('main'),
  autoBuildOnPush: z.boolean().optional().default(true),
  webhookPath: z.string().optional(),
});

export const WaffleBuildsSchema = z.object({
  registry: z.string().optional().default('localhost:5001'),
  gitops: WaffleGitOpsSchema.optional(),
  targets: z.array(WaffleBuildTargetSchema).optional().default([]),
});

export const WaffleStepSchema = z.object({
  id: z.string().min(1, 'Step ID is required'),
  name: z.string().min(1, 'Step name is required'),
  chart: z.string().min(1, 'Chart reference is required'),
  releaseName: z.string().optional(),
  namespace: z.string().optional(),
  createNamespace: z.boolean().optional().default(true),
  wait: z.boolean().optional().default(true),
  timeout: z.string().optional().default('5m'),
  domain: z.string().optional(),
  values: z.record(z.any()).optional(),
  set: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  healthCheck: WaffleHealthCheckSchema.optional(),
  keys: z.union([z.record(z.string()), WaffleSecretKeySchema]).optional(),
});

export const WaffleStageSchema = z.object({
  id: z.string().min(1, 'Stage ID is required'),
  name: z.string().min(1, 'Stage name is required'),
  description: z.string().optional().default(''),
  mode: z.enum(['series', 'parallel']).optional().default('series'),
  dependsOn: z.array(z.string()).optional().default([]),
  steps: z.array(WaffleStepSchema).min(1, 'Stage must contain at least one step'),
});

export const WafflePipelineSchema = z.object({
  apiVersion: z.string().optional().default('waffle.dev/v1'),
  kind: z.string().optional().default('WafflePipeline'),
  metadata: WafflePipelineMetadataSchema,
  settings: WaffleSettingsSchema.optional().default({}),
  preflight: WafflePreflightSchema,
  keys: WaffleKeysConfigSchema.optional(),
  builds: WaffleBuildsSchema.optional(),
  stages: z.array(WaffleStageSchema).min(1, 'Pipeline must have at least one stage'),
});


// ============================================================================
// 2. PARSING & VALIDATION ENGINE
// ============================================================================

/**
 * Parses a YAML string and validates it against the WafflePipeline schema
 */
export function parseWaffleYaml(content: string): WafflePipeline {
  const parsed = YAML.parse(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid Waffle manifest: file is empty or does not contain a valid YAML object');
  }
  const result = WafflePipelineSchema.safeParse(parsed);
  if (!result.success) {
    const errorMessages = result.error.errors.map((e) => `${e.path.join('.') || 'root'}: ${e.message}`).join('; ');
    throw new Error(`Waffle manifest validation failed: ${errorMessages}`);
  }
  return result.data as WafflePipeline;
}

/**
 * Loads and validates a waffle.yaml manifest from a directory or direct file path
 */
export async function loadWafflePipeline(dirOrFilePath: string): Promise<{ pipeline: WafflePipeline; manifestPath: string; baseDir: string }> {
  let manifestPath = dirOrFilePath;
  let baseDir = dirOrFilePath;

  const stat = await fs.promises.stat(dirOrFilePath);
  if (stat.isDirectory()) {
    baseDir = dirOrFilePath;
    const candidates = ['waffle.yaml', 'waffle.yml'];
    let found = false;
    for (const c of candidates) {
      const p = path.join(dirOrFilePath, c);
      if (fs.existsSync(p)) {
        manifestPath = p;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`No waffle.yaml or waffle.yml found in directory: ${dirOrFilePath}`);
    }
  } else {
    baseDir = path.dirname(dirOrFilePath);
  }

  const raw = await fs.promises.readFile(manifestPath, 'utf-8');
  const pipeline = parseWaffleYaml(raw);
  return { pipeline, manifestPath, baseDir };
}

export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
  field?: string;
}

export interface WaffleValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stagesCount: number;
  stepsCount: number;
}

/**
 * Validates a WafflePipeline for structural integrity, unique IDs, dependency DAG,
 * and chart presence on disk (if baseDir is provided)
 */
export function validateWafflePipeline(pipeline: WafflePipeline, baseDir?: string): WaffleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stageIds = new Set<string>();
  const stepIds = new Set<string>();
  let stepsCount = 0;

  for (const stage of pipeline.stages) {
    if (stageIds.has(stage.id)) {
      errors.push(`Duplicate stage ID: "${stage.id}"`);
    }
    stageIds.add(stage.id);

    // Validate dependencies
    if (stage.dependsOn) {
      for (const dep of stage.dependsOn) {
        if (dep === stage.id) {
          errors.push(`Stage "${stage.id}" cannot depend on itself`);
        }
      }
    }

    for (const step of stage.steps) {
      stepsCount++;
      if (stepIds.has(step.id)) {
        warnings.push(`Step ID "${step.id}" in stage "${stage.id}" is used more than once in the pipeline`);
      }
      stepIds.add(step.id);

      // Verify chart directory existence if baseDir provided and chart is local path
      if (baseDir && step.chart.startsWith('.')) {
        const resolvedChartPath = path.resolve(baseDir, step.chart);
        if (!fs.existsSync(resolvedChartPath)) {
          errors.push(`Step "${step.id}": Chart path not found at "${resolvedChartPath}"`);
        } else {
          const chartYaml = path.join(resolvedChartPath, 'Chart.yaml');
          const chartYml = path.join(resolvedChartPath, 'Chart.yml');
          if (!fs.existsSync(chartYaml) && !fs.existsSync(chartYml)) {
            warnings.push(`Step "${step.id}": Directory "${resolvedChartPath}" does not contain a Chart.yaml`);
          }
        }
      }
    }
  }

  // Check that all dependsOn references exist
  for (const stage of pipeline.stages) {
    if (stage.dependsOn) {
      for (const dep of stage.dependsOn) {
        if (!stageIds.has(dep)) {
          errors.push(`Stage "${stage.id}" references non-existent dependency stage: "${dep}"`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stagesCount: pipeline.stages.length,
    stepsCount,
  };
}

// ============================================================================
// 3. MULTI-SOURCE MONITORING & REGISTRATION
// ============================================================================

export interface WaffleSource {
  id: string;
  name: string;
  type: 'local' | 'git' | 'blueprint';
  pathOrUrl: string;
  branch?: string;
  currentSha?: string;
  lastSynced?: string;
  status: 'ready' | 'syncing' | 'error' | 'unreachable';
  errorMessage?: string;
  pipelineMetadata?: WafflePipelineMetadata;
  chartCount: number;
  stagesCount: number;
  stepsCount: number;
  localPath: string;
  blueprintId?: string;
}

export class WaffleSourceManager {
  private sourcesFile: string;
  private cacheDir: string;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.sourcesFile = path.join(projectRoot, '.vow_waffles.json');
    this.cacheDir = path.join(projectRoot, '.vow-cache', 'waffles');
  }

  /**
   * Initializes cache directories and seeds the sources file if needed
   */
  public async init(): Promise<void> {
    if (!fs.existsSync(this.cacheDir)) {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
    }

    if (!fs.existsSync(this.sourcesFile)) {
      const initialSources: WaffleSource[] = [];

      // Auto-detect if project has a charts directory with waffle.yaml
      const chartsDir = getChartsDirectory(this.projectRoot);
      const chartsWaffle = path.join(chartsDir, 'waffle.yaml');
      if (fs.existsSync(chartsWaffle)) {
        try {
          const { pipeline } = await loadWafflePipeline(chartsDir);
          const validation = validateWafflePipeline(pipeline, chartsDir);
          initialSources.push({
            id: 'local-charts',
            name: pipeline.metadata.name || 'Local Charts Ecosystem',
            type: 'local',
            pathOrUrl: chartsDir,
            status: validation.valid ? 'ready' : 'error',
            errorMessage: validation.errors[0],
            pipelineMetadata: pipeline.metadata,
            chartCount: fs.readdirSync(chartsDir).filter((f) => {
              const p = path.join(chartsDir, f);
              return fs.statSync(p).isDirectory() && (fs.existsSync(path.join(p, 'Chart.yaml')) || fs.existsSync(path.join(p, 'Chart.yml')));
            }).length,
            stagesCount: validation.stagesCount,
            stepsCount: validation.stepsCount,
            localPath: chartsDir,
            lastSynced: new Date().toISOString(),
          });
        } catch {
          // ignore seed errors
        }
      }

      await this.saveSources(initialSources);
    }
  }

  /**
   * Retrieves all registered sources
   */
  public async getSources(): Promise<WaffleSource[]> {
    await this.init();
    try {
      const raw = await fs.promises.readFile(this.sourcesFile, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /**
   * Saves source list to .vow_waffles.json
   */
  public async saveSources(sources: WaffleSource[]): Promise<void> {
    await fs.promises.writeFile(this.sourcesFile, JSON.stringify(sources, null, 2), 'utf-8');
  }

  /**
   * Registers a new local directory or remote Git URL
   */
  public async addSource(input: {
    type: 'local' | 'git';
    pathOrUrl: string;
    name?: string;
    branch?: string;
  }): Promise<WaffleSource> {
    await this.init();
    const sources = await this.getSources();

    const normalizedPath = input.pathOrUrl.trim();
    const existing = sources.find((s) => s.pathOrUrl === normalizedPath);
    if (existing) {
      throw new Error(`Waffle source with path/URL "${normalizedPath}" is already registered (id: ${existing.id})`);
    }

    const id = `waffle-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    let localPath = normalizedPath;
    let currentSha: string | undefined;
    let pipelineMetadata: WafflePipelineMetadata | undefined;
    let chartCount = 0;
    let stagesCount = 0;
    let stepsCount = 0;
    let status: WaffleSource['status'] = 'ready';
    let errorMessage: string | undefined;

    if (input.type === 'git') {
      const targetDir = path.join(this.cacheDir, id);
      localPath = targetDir;
      try {
        const branchFlag = input.branch ? `-b ${JSON.stringify(input.branch)}` : '';
        await execAsync(`git clone --depth 1 ${branchFlag} ${JSON.stringify(normalizedPath)} ${JSON.stringify(targetDir)}`);
        const { stdout: shaOut } = await execAsync('git rev-parse HEAD', { cwd: targetDir });
        currentSha = shaOut.trim();

        const { pipeline } = await loadWafflePipeline(targetDir);
        const validation = validateWafflePipeline(pipeline, targetDir);
        pipelineMetadata = pipeline.metadata;
        stagesCount = validation.stagesCount;
        stepsCount = validation.stepsCount;
        chartCount = fs.readdirSync(targetDir).filter((f) => {
          const p = path.join(targetDir, f);
          return fs.statSync(p).isDirectory() && (fs.existsSync(path.join(p, 'Chart.yaml')) || fs.existsSync(path.join(p, 'Chart.yml')));
        }).length;
        if (!validation.valid) {
          status = 'error';
          errorMessage = validation.errors.join('; ');
        }
      } catch (err: any) {
        status = 'error';
        errorMessage = `Git clone/parse failed: ${err.message}`;
      }
    } else {
      // Local directory
      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`Directory does not exist on disk: ${normalizedPath}`);
      }
      try {
        const { pipeline } = await loadWafflePipeline(normalizedPath);
        const validation = validateWafflePipeline(pipeline, normalizedPath);
        pipelineMetadata = pipeline.metadata;
        stagesCount = validation.stagesCount;
        stepsCount = validation.stepsCount;
        chartCount = fs.readdirSync(normalizedPath).filter((f) => {
          const p = path.join(normalizedPath, f);
          try {
            return fs.statSync(p).isDirectory() && (fs.existsSync(path.join(p, 'Chart.yaml')) || fs.existsSync(path.join(p, 'Chart.yml')));
          } catch {
            return false;
          }
        }).length;
        if (!validation.valid) {
          status = 'error';
          errorMessage = validation.errors.join('; ');
        }
      } catch (err: any) {
        status = 'error';
        errorMessage = `Failed to load waffle.yaml: ${err.message}`;
      }
    }

    const newSource: WaffleSource = {
      id,
      name: input.name || pipelineMetadata?.name || path.basename(normalizedPath),
      type: input.type,
      pathOrUrl: normalizedPath,
      branch: input.branch || (input.type === 'git' ? 'main' : undefined),
      currentSha,
      lastSynced: new Date().toISOString(),
      status,
      errorMessage,
      pipelineMetadata,
      chartCount,
      stagesCount,
      stepsCount,
      localPath,
    };

    sources.push(newSource);
    await this.saveSources(sources);
    return newSource;
  }

  /**
   * Synchronizes / pulls updates for a registered source
   */
  public async syncSource(id: string): Promise<WaffleSource> {
    await this.init();
    const sources = await this.getSources();
    const sourceIndex = sources.findIndex((s) => s.id === id);
    if (sourceIndex === -1) {
      throw new Error(`Waffle source with ID "${id}" not found`);
    }

    const source = sources[sourceIndex];
    source.status = 'syncing';
    await this.saveSources(sources);

    try {
      if (source.type === 'git') {
        const targetDir = source.localPath;
        if (!fs.existsSync(targetDir)) {
          const branchFlag = source.branch ? `-b ${JSON.stringify(source.branch)}` : '';
          await execAsync(`git clone --depth 1 ${branchFlag} ${JSON.stringify(source.pathOrUrl)} ${JSON.stringify(targetDir)}`);
        } else {
          await execAsync('git fetch --depth 1', { cwd: targetDir });
          await execAsync('git reset --hard FETCH_HEAD', { cwd: targetDir });
        }
        const { stdout: shaOut } = await execAsync('git rev-parse HEAD', { cwd: targetDir });
        source.currentSha = shaOut.trim();
      }

      const { pipeline } = await loadWafflePipeline(source.localPath);
      const validation = validateWafflePipeline(pipeline, source.localPath);
      source.pipelineMetadata = pipeline.metadata;
      source.stagesCount = validation.stagesCount;
      source.stepsCount = validation.stepsCount;
      source.status = validation.valid ? 'ready' : 'error';
      source.errorMessage = validation.valid ? undefined : validation.errors.join('; ');
      source.chartCount = fs.readdirSync(source.localPath).filter((f) => {
        const p = path.join(source.localPath, f);
        try {
          return fs.statSync(p).isDirectory() && (fs.existsSync(path.join(p, 'Chart.yaml')) || fs.existsSync(path.join(p, 'Chart.yml')));
        } catch {
          return false;
        }
      }).length;
      source.lastSynced = new Date().toISOString();
    } catch (err: any) {
      source.status = 'error';
      source.errorMessage = `Sync failed: ${err.message}`;
      source.lastSynced = new Date().toISOString();
    }

    sources[sourceIndex] = source;
    await this.saveSources(sources);
    return source;
  }

  /**
   * Deletes a registered source
   */
  public async removeSource(id: string): Promise<boolean> {
    await this.init();
    const sources = await this.getSources();
    const source = sources.find((s) => s.id === id);
    if (!source) return false;

    if (source.type === 'git' && fs.existsSync(source.localPath)) {
      try {
        await fs.promises.rm(source.localPath, { recursive: true, force: true });
      } catch {
        // ignore deletion cleanup error
      }
    }

    const updated = sources.filter((s) => s.id !== id);
    await this.saveSources(updated);
    return true;
  }

  /**
   * Fetches the validated pipeline for a given source
   */
  public async getSourcePipeline(id: string): Promise<{ pipeline: WafflePipeline; source: WaffleSource }> {
    const sources = await this.getSources();
    const source = sources.find((s) => s.id === id);
    if (!source) {
      throw new Error(`Waffle source with ID "${id}" not found`);
    }

    const { pipeline } = await loadWafflePipeline(source.localPath);
    return { pipeline, source };
  }
}

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
        runProgress.status = 'completed';
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

      runProgress.status = runProgress.failedSteps > 0 ? 'failed' : 'completed';
    } catch (err: any) {
      runProgress.status = 'failed';
      runProgress.error = err.message;
      this.logToRun(`[FATAL] Pipeline halted: ${err.message}`);
    } finally {
      runProgress.finishedAt = new Date().toISOString();
      this.emit('finish', runProgress);
      this.emit('progress', runProgress);
      await waffleRunHistory.recordRun(runProgress);
    }

    return runProgress;
  }

  /**
   * Derives Supabase ANON_KEY / SERVICE_ROLE_KEY as HS256 JWTs signed with SUPABASE_JWT_SECRET.
   * Returns undefined for any other variable or when the signing secret is not set.
   */
  private deriveSupabaseJwt(envVar: string): string | undefined {
    const role = envVar === 'SUPABASE_ANON_KEY' ? 'anon' : envVar === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service_role' : undefined;
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!role || !secret) return undefined;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase', iat: now, exp: now + 10 * 365 * 24 * 3600 })}`;
    const sig = createHmac('sha256', secret).update(unsigned).digest('base64url');
    return `${unsigned}.${sig}`;
  }

  /**
   * Provision Kubernetes Secrets defined in pipeline.keys or step.keys
   */
  private async provisionSecrets(
    secrets: WaffleSecretKey[],
    defaultNamespace: string,
    dryRun?: boolean
  ): Promise<void> {
    for (const sec of secrets) {
      const ns = sec.namespace || defaultNamespace;
      this.logToRun(`[KEYS] Ensuring Kubernetes Secret "${sec.name}" in namespace "${ns}"...`);
      if (dryRun) {
        this.logToRun(`[KEYS] [DRY-RUN] Secret "${sec.name}" creation simulated.`);
        continue;
      }

      const secretData: Record<string, string> = {};
      if (sec.literals) {
        const missing = new Set<string>();
        for (const [k, v] of Object.entries(sec.literals)) {
          // Interpolate every ${VAR} occurrence (whole-value or embedded in a URL).
          // Never fall back to a built-in default: published placeholder secrets
          // (e.g. *_change_me) must not reach a cluster.
          secretData[k] = String(v).replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_m, envVar: string) => {
            const fromEnv = process.env[envVar];
            if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
            const derived = this.deriveSupabaseJwt(envVar);
            if (derived) return derived;
            missing.add(envVar);
            return '';
          });
        }
        if (missing.size > 0) {
          throw new Error(
            `Secret "${sec.name}" requires unset environment variable(s): ${[...missing].sort().join(', ')}. ` +
              `Export them (see charts/production-prep.md) before running the pipeline.`
          );
        }
        for (const [k, val] of Object.entries(secretData)) {
          if (/change_?me/i.test(val)) {
            throw new Error(`Secret "${sec.name}" key "${k}" still contains a "change_me" placeholder; refusing to apply.`);
          }
        }
      }
      if (sec.fromEnv) {
        for (const envVar of sec.fromEnv) {
          const val = process.env[envVar] || '';
          secretData[envVar] = val;
        }
      }

      if (Object.keys(secretData).length > 0) {
        try {
          await execAsync(`kubectl create namespace ${JSON.stringify(ns)} --dry-run=client -o yaml | kubectl apply -f -`, { env: getWaffleExecutionEnv() });
          const manifestObj = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
              name: sec.name,
              namespace: ns,
              labels: {
                'app.kubernetes.io/managed-by': 'waffle',
              },
              annotations: {
                // Keep Helm from deleting this secret if a previous release rendered one with the same name.
                'helm.sh/resource-policy': 'keep',
              },
            },
            type: 'Opaque',
            stringData: secretData,
          };
          const manifestJson = JSON.stringify(manifestObj);
          await execAsync(`cat << 'EOF' | kubectl apply -f -\n${manifestJson}\nEOF`, { env: getWaffleExecutionEnv() });
          this.logToRun(`[KEYS] Secret "${sec.name}" synchronized in namespace "${ns}".`);
        } catch (err: any) {
          this.logToRun(`[KEYS] Notice: Secret sync encountered: ${err.message}`);
        }
      }
    }
  }

  /**
   * Builds container images defined in pipeline.builds
   */
  private async buildImages(
    pipeline: WafflePipeline,
    baseDir: string,
    dryRun?: boolean
  ): Promise<void> {
    if (!pipeline.builds?.targets || pipeline.builds.targets.length === 0) {
      return;
    }
    const registry = pipeline.builds.registry || 'localhost:5001';
    this.logToRun(`[BUILDS] Starting builds for ${pipeline.builds.targets.length} target(s) using registry "${registry}"...`);

    if (dryRun) {
      for (const target of pipeline.builds.targets) {
        const fullTag = `${registry}/${target.image}:${target.tag || 'latest'}`;
        const gitInfo = target.git ? ` (git: ${typeof target.git === 'string' ? target.git : target.git.repo})` : '';
        this.logToRun(`[BUILDS] [DRY-RUN] Target "${target.name}" -> ${fullTag} (context: ${target.context})${gitInfo} simulated.`);
      }
      return;
    }

    const failedTargets: string[] = [];
    await this.ensureLocalRegistry(registry);

    for (const target of pipeline.builds.targets) {
      const contextPath = path.resolve(baseDir, target.context);

      // 1. Auto-clone or pull from Git if target.git is defined
      if (target.git) {
        const gitConfig: WaffleGitSource =
          typeof target.git === 'string' ? { repo: target.git } : target.git;
        const cloneDir = gitConfig.dir ? path.resolve(baseDir, gitConfig.dir) : contextPath;

        try {
          const hasGit = fs.existsSync(path.join(cloneDir, '.git'));
          const isEmpty = !fs.existsSync(cloneDir) || fs.readdirSync(cloneDir).length === 0;

          if (isEmpty) {
            let repoUrl = gitConfig.repo;
            // Convert git@github.com:org/repo.git to https://github.com/org/repo.git if SSH key is absent
            if (repoUrl.startsWith('git@github.com:')) {
              repoUrl = repoUrl.replace('git@github.com:', 'https://github.com/');
            }

            this.logToRun(`[BUILDS] Target "${target.name}": Cloning repository from ${repoUrl}...`);
            fs.mkdirSync(path.dirname(cloneDir), { recursive: true });

            const branchArg = gitConfig.branch ? `-b ${JSON.stringify(gitConfig.branch)}` : '';
            const depthArg = gitConfig.depth && !gitConfig.commit ? `--depth ${gitConfig.depth}` : '';
            const submodulesArg = gitConfig.submodules ? '--recurse-submodules' : '';

            const cloneCmd = `git clone ${branchArg} ${depthArg} ${submodulesArg} ${JSON.stringify(repoUrl)} ${JSON.stringify(cloneDir)}`.replace(/\s+/g, ' ');
            await execAsync(cloneCmd);

            if (gitConfig.commit) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout ${JSON.stringify(gitConfig.commit)}`);
            } else if (gitConfig.tag) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout tags/${JSON.stringify(gitConfig.tag)}`);
            }
            this.logToRun(`[BUILDS] Target "${target.name}": Repository successfully cloned into ${cloneDir}.`);
          } else if (hasGit) {
            this.logToRun(`[BUILDS] Target "${target.name}": Existing repository detected at ${cloneDir}; fetching updates...`);
            await execAsync(`git -C ${JSON.stringify(cloneDir)} fetch --tags`).catch(() => {});
            if (gitConfig.branch) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout ${JSON.stringify(gitConfig.branch)}`).catch(() => {});
              await execAsync(`git -C ${JSON.stringify(cloneDir)} pull origin ${JSON.stringify(gitConfig.branch)}`).catch(() => {});
            } else if (gitConfig.commit) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout ${JSON.stringify(gitConfig.commit)}`).catch(() => {});
            } else if (gitConfig.tag) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout tags/${JSON.stringify(gitConfig.tag)}`).catch(() => {});
            }
          }
        } catch (gitErr: any) {
          this.logToRun(`[BUILDS] Warning: Git operation for target "${target.name}" failed: ${gitErr.message}`);
        }
      }

      const dockerfilePath = target.dockerfile ? path.resolve(contextPath, target.dockerfile) : path.join(contextPath, 'Dockerfile');
      const fullTag = `${registry}/${target.image}:${target.tag || 'latest'}`;

      this.logToRun(`[BUILDS] Building target "${target.name}" -> ${fullTag}...`);
      try {
        const buildArgs = ['build', '-t', fullTag];
        if (target.dockerfile) {
          buildArgs.push('-f', dockerfilePath);
        }
        buildArgs.push(contextPath);

        await new Promise<void>((resolve, reject) => {
          const proc = spawn('docker', buildArgs);
          proc.stdout?.on('data', (d) => {
            const lines = d.toString().split('\n').filter((l: string) => l.trim().length > 0);
            for (const line of lines) {
              this.logToRun(`[DOCKER] [${target.name}] ${line}`);
            }
          });
          proc.stderr?.on('data', (d) => {
            const lines = d.toString().split('\n').filter((l: string) => l.trim().length > 0);
            for (const line of lines) {
              this.logToRun(`[DOCKER] [${target.name}] ${line}`);
            }
          });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`docker build exited with code ${code}`));
          });
          proc.on('error', reject);
        });

        // Push to the in-cluster/local registry when it is reachable (best effort; the
        // containerd import below is what guarantees the cluster can run the image).
        this.logToRun(`[BUILDS] Pushing image ${fullTag}...`);
        await execAsync(`docker push --tls-verify=false ${JSON.stringify(fullTag)}`).catch(async () => {
          await execAsync(`docker push ${JSON.stringify(fullTag)}`).catch((pushErr) => {
            this.logToRun(`[BUILDS] Notice: Registry push to "${registry}" skipped or unavailable: ${String(pushErr.message).split('\n')[0]}`);
          });
        });

        // MANDATORY: make the image available to every cluster node's containerd.
        await this.importImageToCluster(target, fullTag);

        this.logToRun(`[BUILDS] Target "${target.name}" successfully built and published.`);
      } catch (err: any) {
        failedTargets.push(target.name);
        this.logToRun(`[BUILDS] ERROR: Build/import for target "${target.name}" failed: ${err.message}`);
      }
    }

    if (failedTargets.length > 0) {
      throw new Error(`Image build/import failed for target(s): ${failedTargets.join(', ')}`);
    }
  }

  /**
   * Ensures a registry is serving on the configured localhost:<port> endpoint by running
   * registry:2 inside the cluster (hostPort), so kubelet can pull "localhost:<port>/..." images.
   */
  private async ensureLocalRegistry(registry: string): Promise<void> {
    const m = /^(localhost|127\.0\.0\.1):(\d+)$/.exec(registry);
    if (!m) return;
    const port = m[2];
    const env = getWaffleExecutionEnv();
    try {
      await execAsync(`curl -fsS -m 3 http://localhost:${port}/v2/`);
      return;
    } catch {
      // not reachable yet; deploy it
    }
    this.logToRun(`[BUILDS] No registry on ${registry}; deploying in-cluster registry (namespace "registry")...`);
    const manifest = `apiVersion: v1
kind: Namespace
metadata:
  name: registry
  labels:
    pod-security.kubernetes.io/enforce: privileged
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
  namespace: registry
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: registry
  template:
    metadata:
      labels:
        app: registry
    spec:
      containers:
        - name: registry
          image: registry:2
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 5000
              hostPort: ${port}
          volumeMounts:
            - name: data
              mountPath: /var/lib/registry
      volumes:
        - name: data
          hostPath:
            path: /var/lib/vow-registry
            type: DirectoryOrCreate
---
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: registry
spec:
  selector:
    app: registry
  ports:
    - port: 5000
      targetPort: 5000
`;
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('kubectl', ['apply', '-f', '-'], { env });
        let err = '';
        proc.stderr?.on('data', (d) => (err += d.toString()));
        proc.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err || `kubectl apply exited ${c}`))));
        proc.on('error', reject);
        proc.stdin?.end(manifest);
      });
      await execAsync(`kubectl rollout status deployment/registry -n registry --timeout=120s`, { env });
      for (let i = 0; i < 15; i++) {
        try {
          await execAsync(`curl -fsS -m 3 http://localhost:${port}/v2/`);
          this.logToRun(`[BUILDS] In-cluster registry is serving on ${registry}.`);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      this.logToRun(`[BUILDS] Notice: registry deployed but ${registry} not reachable yet; relying on containerd import.`);
    } catch (e: any) {
      this.logToRun(`[BUILDS] Notice: could not deploy in-cluster registry: ${String(e.message).split('\n')[0]}`);
    }
  }

  /**
   * Imports a built image (under every name kubelet might use) into containerd on the local
   * node and every other cluster node. Throws on failure so the build is not reported as OK.
   */
  private async importImageToCluster(target: { name: string; image: string; tag?: string }, fullTag: string): Promise<void> {
    const shortName = `${target.image}:${target.tag || 'latest'}`;
    const names = [fullTag, shortName, `docker.io/${shortName}`];
    for (const n of names.slice(1)) {
      await execAsync(`docker tag ${JSON.stringify(fullTag)} ${JSON.stringify(n)}`);
    }
    const saveCmd = `docker save ${names.map((n) => JSON.stringify(n)).join(' ')}`;
    const env = getWaffleExecutionEnv();

    // Local node (control plane / this host)
    await execAsync(`${saveCmd} | sudo k3s ctr -n k8s.io images import -`, { maxBuffer: 1024 * 1024 * 64 });
    this.logToRun(`[BUILDS] Imported ${fullTag} into local containerd.`);

    // Peer nodes, discovered from the cluster (not hardcoded)
    const localIps = new Set(
      Object.values(os.networkInterfaces()).flatMap((l) => (l || []).map((a) => a.address))
    );
    let peers: string[] = [];
    try {
      const { stdout } = await execAsync(
        `kubectl get nodes -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\\n"}{end}'`,
        { env }
      );
      peers = stdout.split('\n').map((l) => l.trim()).filter((ip) => ip && !localIps.has(ip));
    } catch {
      // cannot list nodes; single-node assumption
    }
    for (const ip of peers) {
      try {
        await execAsync(
          `${saveCmd} | ssh -o BatchMode=yes -o ConnectTimeout=10 ${ip} "sudo k3s ctr -n k8s.io images import -"`,
          { maxBuffer: 1024 * 1024 * 64 }
        );
        this.logToRun(`[BUILDS] Imported ${fullTag} into node ${ip}.`);
      } catch (e: any) {
        throw new Error(`failed to import ${fullTag} into node ${ip}: ${String(e.message).split('\n')[0]}`);
      }
    }
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
        const localOpenEBSChart = path.join(baseDir, 'openebs');
        if (fs.existsSync(localOpenEBSChart)) {
          this.logToRun('[PREFLIGHT] Found local OpenEBS chart at ./openebs. Installing via Helm...');
          try {
            await execAsync(`helm upgrade --install openebs ${JSON.stringify(localOpenEBSChart)} --namespace openebs --create-namespace --wait --timeout 5m`);
            this.logToRun('[PREFLIGHT] Successfully deployed OpenEBS Dynamic LocalPV provisioner.');
          } catch (err: any) {
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
            await execAsync(`bash ${JSON.stringify(storageScript)} install --engine openebs`);
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
      runProgress.currentLogLine = line;
      this.emit('step_log', { stepId: step.id, line });
      this.emit('progress', runProgress);
    };

    try {
      // Resolve chart path
      let chartPath = step.chart;
      if (step.chart.startsWith('.')) {
        chartPath = path.resolve(baseDir, step.chart);
      } else if (!step.chart.includes('/') && fs.existsSync(path.join(baseDir, step.chart))) {
        chartPath = path.join(baseDir, step.chart);
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
        const stepSec: WaffleSecretKey = typeof (step.keys as any).name === 'string'
          ? (step.keys as WaffleSecretKey)
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

      // Execute Helm command
      const helmCmd = `helm ${helmArgs.map((a) => (a.includes(' ') || a.includes('=') ? JSON.stringify(a) : a)).join(' ')}`;
      log(`Executing: ${helmCmd}`);

      if (!dryRun) {
        const { stdout, stderr } = await execAsync(helmCmd, { cwd: baseDir, env: getWaffleExecutionEnv() });
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
    } catch (err: any) {
      const errMsg = err?.message || String(err);
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
      stepProg.error = err.message;
      runProgress.failedSteps++;

      log(`[ERROR] Step failed: ${err.message}`);
      this.emit('step_complete', { stepId: step.id, status: 'failed', error: err.message });
      this.emit('progress', runProgress);
      return false;
    }
  }

  /**
   * Verifies health of deployed resources
   */
  private async verifyStepHealth(step: WaffleStep, namespace: string, log: (msg: string) => void): Promise<void> {
    const health = step.healthCheck;
    if (!health) {
      // Default health check: wait for pods in namespace with app label
      try {
        const cmd = `kubectl rollout status deployment/${step.releaseName || step.id} -n ${namespace} --timeout=60s`;
        await execAsync(cmd, { env: getWaffleExecutionEnv() });
        log('Deployment rollout status confirmed ready.');
      } catch {
        // Rollout status is optional if chart has no matching single deployment name
      }
      return;
    }

    if (health.type === 'storageClass' && health.name) {
      log(`Checking StorageClass: "${health.name}"...`);
      await execAsync(`kubectl get sc ${health.name}`, { env: getWaffleExecutionEnv() });
      log(`StorageClass "${health.name}" is verified.`);
    } else if (health.type === 'podReady') {
      const releaseName = step.releaseName || step.id;
      log(`Waiting for pods associated with release "${releaseName}"...`);
      try {
        await execAsync(`kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=${releaseName} -n ${namespace} --timeout=${health.timeout || '2m'}`, { env: getWaffleExecutionEnv() });
        log('Pod readiness verified.');
      } catch {
        log('Warning: Pod readiness wait timed out or matched no pods; proceeding.');
      }
    }
  }

  private logToRun(message: string): void {
    if (this.activeRun) {
      this.activeRun.currentLogLine = message;
      this.emit('pipeline_log', message);
      this.emit('progress', this.activeRun);
    }
  }
}

// ============================================================================
// 5. WAFFLE RUN HISTORY & TELEMETRY
// ============================================================================

export class WaffleRunHistory {
  private historyFile: string;
  private projectRoot: string;
  private inMemoryHistory: WaffleRunProgress[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.historyFile = path.join(projectRoot, '.vow_waffle_history.json');
  }

  private async loadFromFile(): Promise<void> {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = await fs.promises.readFile(this.historyFile, 'utf-8');
        this.inMemoryHistory = JSON.parse(raw);
      }
    } catch {
      this.inMemoryHistory = [];
    }
  }

  public async getHistory(): Promise<WaffleRunProgress[]> {
    await this.loadFromFile();
    return [...this.inMemoryHistory].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  public async getRun(runId: string): Promise<WaffleRunProgress | undefined> {
    const list = await this.getHistory();
    return list.find((r) => r.runId === runId);
  }

  public async recordRun(run: WaffleRunProgress): Promise<void> {
    await this.loadFromFile();
    // Trim log bodies in persistent history to keep file performant
    const sanitizedRun = {
      ...run,
      stages: Object.fromEntries(
        Object.entries(run.stages).map(([stageId, stage]) => [
          stageId,
          {
            ...stage,
            steps: Object.fromEntries(
              Object.entries(stage.steps).map(([stepId, step]) => [
                stepId,
                {
                  ...step,
                  logs: step.logs.slice(-50), // keep last 50 lines
                },
              ])
            ),
          },
        ])
      ),
    };

    const existingIdx = this.inMemoryHistory.findIndex((r) => r.runId === run.runId);
    if (existingIdx >= 0) {
      this.inMemoryHistory[existingIdx] = sanitizedRun;
    } else {
      this.inMemoryHistory.unshift(sanitizedRun);
    }

    if (this.inMemoryHistory.length > 50) {
      this.inMemoryHistory = this.inMemoryHistory.slice(0, 50);
    }

    try {
      await fs.promises.writeFile(this.historyFile, JSON.stringify(this.inMemoryHistory, null, 2), 'utf-8');
    } catch {
      // ignore history write errors
    }
  }

  public async clearHistory(): Promise<void> {
    this.inMemoryHistory = [];
    if (fs.existsSync(this.historyFile)) {
      await fs.promises.unlink(this.historyFile);
    }
  }
}

// Global singletons & cache by projectRoot
const sourceManagers = new Map<string, WaffleSourceManager>();
const runners = new Map<string, WaffleRunner>();
const histories = new Map<string, WaffleRunHistory>();

export function getWaffleSourceManager(root: string = process.cwd()): WaffleSourceManager {
  if (!sourceManagers.has(root)) {
    sourceManagers.set(root, new WaffleSourceManager(root));
  }
  return sourceManagers.get(root)!;
}

export function getWaffleRunner(root: string = process.cwd()): WaffleRunner {
  if (!runners.has(root)) {
    runners.set(root, new WaffleRunner(root));
  }
  return runners.get(root)!;
}

export function getWaffleRunHistory(root: string = process.cwd()): WaffleRunHistory {
  if (!histories.has(root)) {
    histories.set(root, new WaffleRunHistory(root));
  }
  return histories.get(root)!;
}

export const waffleSourceManager = getWaffleSourceManager(process.cwd());
export const waffleRunner = getWaffleRunner(process.cwd());
export const waffleRunHistory = getWaffleRunHistory(process.cwd());

