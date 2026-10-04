/**
 * Waffle pipeline sources and their manager (WS6 split of waffle.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getChartsDirectory } from '../config.js';
import { execAsync } from './shared.js';
import { type WafflePipelineMetadata, type WafflePipeline, loadWafflePipeline, validateWafflePipeline } from './schema.js';

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
