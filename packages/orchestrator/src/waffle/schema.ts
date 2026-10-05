/**
 * Waffle pipeline schema: types, zod schemas, YAML parsing/loading, validation (WS6 split of waffle.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

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
  literals: z.record(z.string(), z.string()).optional(),
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
  values: z.record(z.string(), z.any()).optional(),
  set: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  healthCheck: WaffleHealthCheckSchema.optional(),
  keys: z.union([z.record(z.string(), z.string()), WaffleSecretKeySchema]).optional(),
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
  settings: WaffleSettingsSchema.prefault({}),
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
    const errorMessages = result.error.issues.map((e) => `${e.path.join('.') || 'root'}: ${e.message}`).join('; ');
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
