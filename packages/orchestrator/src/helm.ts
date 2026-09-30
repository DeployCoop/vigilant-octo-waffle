import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { processManager, type TaskRun } from './executor.js';
import { loadProjectConfig, getChartsDirectory } from './config.js';
import type { AppCategory } from './registry.js';

const execAsync = promisify(exec);

export interface HelmReleaseInfo {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  appVersion: string;
}

export interface LocalChartDefinition {
  id: string;
  name: string;
  version: string;
  appVersion?: string;
  description: string;
  category: AppCategory;
  icon?: string;
  home?: string;
  sources?: string[];
  keywords?: string[];
  dependencies?: Array<{ name: string; version: string; repository?: string }>;
  maintainers?: Array<{ name: string; email?: string }>;
  chartPath: string;
  relPath: string;
  hasValues: boolean;
  hasTemplates: boolean;
  templateCount: number;
  valid: boolean;
  error?: string;
  enablerVar: string;
  isLocalChart: true;
}

export interface LocalChartDetail extends LocalChartDefinition {
  rawChartYaml: string;
  rawValuesYaml: string;
  templates: Array<{ name: string; path: string; content?: string }>;
  readme?: string;
}

/**
 * Lists all active Helm releases across all namespaces in the current cluster
 */
export async function listHelmReleases(): Promise<HelmReleaseInfo[]> {
  try {
    const { stdout } = await execAsync('helm list -A -o json');
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => ({
      name: item.name || '',
      namespace: item.namespace || '',
      revision: String(item.revision || '1'),
      updated: item.updated || '',
      status: item.status || 'unknown',
      chart: item.chart || '',
      appVersion: item.app_version || '',
    }));
  } catch {
    return [];
  }
}

/**
 * Retrieves the user-supplied values for a deployed Helm release
 */
export async function getHelmReleaseValues(name: string, namespace: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`helm get values ${JSON.stringify(name)} -n ${JSON.stringify(namespace)} -a`);
    return stdout;
  } catch (err: any) {
    return `# Failed to retrieve values: ${err.message}`;
  }
}

/**
 * Scans a directory and parses a single chart if Chart.yaml is present
 */
function parseChartDirectory(chartDir: string, projectRoot: string): LocalChartDefinition | null {
  const chartYamlPath = fs.existsSync(path.join(chartDir, 'Chart.yaml'))
    ? path.join(chartDir, 'Chart.yaml')
    : fs.existsSync(path.join(chartDir, 'Chart.yml'))
    ? path.join(chartDir, 'Chart.yml')
    : null;

  if (!chartYamlPath) return null;

  try {
    const rawContent = fs.readFileSync(chartYamlPath, 'utf-8');
    const parsed = (YAML.parse(rawContent) || {}) as Record<string, any>;

    const folderName = path.basename(chartDir);
    const chartName = String(parsed.name || folderName);
    const id = chartName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '') || folderName;

    const valuesPath = fs.existsSync(path.join(chartDir, 'values.yaml'))
      ? path.join(chartDir, 'values.yaml')
      : fs.existsSync(path.join(chartDir, 'values.yml'))
      ? path.join(chartDir, 'values.yml')
      : null;

    const templatesDir = path.join(chartDir, 'templates');
    let templateCount = 0;
    if (fs.existsSync(templatesDir) && fs.statSync(templatesDir).isDirectory()) {
      templateCount = fs
        .readdirSync(templatesDir)
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.tpl') || f === 'NOTES.txt')
        .length;
    }

    const relPath = path.relative(projectRoot, chartDir);
    const enablerVar = `${id.toUpperCase().replace(/-/g, '_')}_ENABLED`;

    return {
      id,
      name: chartName,
      version: String(parsed.version || '0.1.0'),
      appVersion: parsed.appVersion ? String(parsed.appVersion) : undefined,
      description: parsed.description || `Local Helm chart (${chartName})`,
      category: 'Custom & Local Charts',
      icon: parsed.icon || 'Ship',
      home: parsed.home,
      sources: Array.isArray(parsed.sources) ? parsed.sources : undefined,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
      maintainers: Array.isArray(parsed.maintainers) ? parsed.maintainers : [],
      chartPath: chartDir,
      relPath: relPath || '.',
      hasValues: Boolean(valuesPath),
      hasTemplates: templateCount > 0,
      templateCount,
      valid: Boolean(parsed.name && parsed.version),
      enablerVar,
      isLocalChart: true,
    };
  } catch (err: any) {
    const folderName = path.basename(chartDir);
    return {
      id: folderName,
      name: folderName,
      version: '0.0.0',
      description: `Invalid Chart.yaml: ${err.message}`,
      category: 'Custom & Local Charts',
      icon: 'AlertCircle',
      chartPath: chartDir,
      relPath: path.relative(projectRoot, chartDir),
      hasValues: false,
      hasTemplates: false,
      templateCount: 0,
      valid: false,
      error: err.message,
      enablerVar: `${folderName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ENABLED`,
      isLocalChart: true,
    };
  }
}

/**
 * Lists all local charts in the configured charts directory (or custom path)
 */
export function listLocalCharts(projectRoot: string, customDir?: string): LocalChartDefinition[] {
  let targetDir: string;
  if (customDir && customDir.trim()) {
    const trimmed = customDir.trim();
    targetDir = path.isAbsolute(trimmed) ? trimmed : path.resolve(projectRoot, trimmed);
  } else {
    targetDir = getChartsDirectory(projectRoot);
  }

  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    return [];
  }

  // Check if targetDir itself is a Helm chart
  const singleChart = parseChartDirectory(targetDir, projectRoot);
  if (singleChart && singleChart.valid) {
    return [singleChart];
  }

  // Scan subdirectories
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const charts: LocalChartDefinition[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const subPath = path.join(targetDir, entry.name);
      const chart = parseChartDirectory(subPath, projectRoot);
      if (chart) {
        charts.push(chart);
      }
    }
  }

  return charts.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Retrieves full details for a local chart, including values.yaml and templates
 */
export function getLocalChartDetail(
  projectRoot: string,
  chartId: string,
  customDir?: string
): LocalChartDetail | null {
  const charts = listLocalCharts(projectRoot, customDir);
  const chart = charts.find((c) => c.id === chartId || c.name === chartId || path.basename(c.chartPath) === chartId);
  if (!chart) return null;

  const chartDir = chart.chartPath;
  const chartYamlPath = fs.existsSync(path.join(chartDir, 'Chart.yaml'))
    ? path.join(chartDir, 'Chart.yaml')
    : path.join(chartDir, 'Chart.yml');
  const rawChartYaml = fs.existsSync(chartYamlPath) ? fs.readFileSync(chartYamlPath, 'utf-8') : '';

  const valuesPath = fs.existsSync(path.join(chartDir, 'values.yaml'))
    ? path.join(chartDir, 'values.yaml')
    : path.join(chartDir, 'values.yml');
  const rawValuesYaml = valuesPath && fs.existsSync(valuesPath) ? fs.readFileSync(valuesPath, 'utf-8') : '';

  const readmePath = path.join(chartDir, 'README.md');
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, 'utf-8') : undefined;

  const templatesDir = path.join(chartDir, 'templates');
  const templates: Array<{ name: string; path: string; content?: string }> = [];

  if (fs.existsSync(templatesDir) && fs.statSync(templatesDir).isDirectory()) {
    const files = fs.readdirSync(templatesDir);
    for (const f of files) {
      const fullPath = path.join(templatesDir, f);
      if (fs.statSync(fullPath).isFile()) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          templates.push({ name: f, path: path.relative(projectRoot, fullPath), content });
        } catch {
          templates.push({ name: f, path: path.relative(projectRoot, fullPath) });
        }
      }
    }
  }

  return {
    ...chart,
    rawChartYaml,
    rawValuesYaml,
    templates,
    readme,
  };
}

/**
 * Installs or upgrades a local chart using the Helm CLI via processManager
 */
export function installLocalChart(
  projectRoot: string,
  chartId: string,
  options: {
    namespace?: string;
    releaseName?: string;
    valuesYaml?: string;
    wait?: boolean;
    timeout?: string;
    set?: Record<string, string>;
    customDir?: string;
  } = {}
): TaskRun {
  const chartDetail = getLocalChartDetail(projectRoot, chartId, options.customDir);
  if (!chartDetail) {
    throw new Error(`Local chart '${chartId}' not found`);
  }

  const config = loadProjectConfig(projectRoot);
  const releaseName = options.releaseName || chartDetail.id;
  const namespace = options.namespace || config.cluster.namespace || 'default';
  const timeout = options.timeout || config.raw['THIS_HELM_TIMEOUT'] || '15m0s';

  const args: string[] = [
    'upgrade',
    '--install',
    releaseName,
    chartDetail.chartPath,
    '--namespace',
    namespace,
    '--create-namespace',
    '--timeout',
    timeout,
  ];

  if (options.wait !== false) {
    args.push('--wait');
  }

  if (options.valuesYaml && options.valuesYaml.trim()) {
    const cacheDir = path.join(projectRoot, '.vow-cache', 'helm');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const valuesFile = path.join(cacheDir, `${releaseName}-values.yaml`);
    fs.writeFileSync(valuesFile, options.valuesYaml, 'utf-8');
    args.push('-f', valuesFile);
  }

  if (options.set) {
    for (const [k, v] of Object.entries(options.set)) {
      args.push('--set', `${k}=${v}`);
    }
  }

  return processManager.runCommand('helm', args, {
    cwd: projectRoot,
    env: config.raw,
  });
}

/**
 * Uninstalls a deployed Helm release
 */
export function uninstallLocalChart(
  projectRoot: string,
  releaseName: string,
  namespace: string = 'default'
): TaskRun {
  const config = loadProjectConfig(projectRoot);
  return processManager.runCommand(
    'helm',
    ['uninstall', releaseName, '--namespace', namespace],
    {
      cwd: projectRoot,
      env: config.raw,
    }
  );
}

/**
 * Runs `helm lint` against a local chart
 */
export async function lintLocalChart(
  projectRoot: string,
  chartId: string,
  customDir?: string
): Promise<{ valid: boolean; output: string }> {
  const chartDetail = getLocalChartDetail(projectRoot, chartId, customDir);
  if (!chartDetail) {
    return { valid: false, output: `Local chart '${chartId}' not found` };
  }

  try {
    const { stdout, stderr } = await execAsync(`helm lint ${JSON.stringify(chartDetail.chartPath)}`);
    return {
      valid: true,
      output: (stdout + '\n' + stderr).trim(),
    };
  } catch (err: any) {
    return {
      valid: false,
      output: (err.stdout || '' + '\n' + (err.stderr || err.message)).trim(),
    };
  }
}

/**
 * Renders Kubernetes manifests from a local chart using `helm template`
 */
export async function templateLocalChart(
  projectRoot: string,
  chartId: string,
  options: {
    namespace?: string;
    releaseName?: string;
    valuesYaml?: string;
    customDir?: string;
  } = {}
): Promise<string> {
  const chartDetail = getLocalChartDetail(projectRoot, chartId, options.customDir);
  if (!chartDetail) {
    throw new Error(`Local chart '${chartId}' not found`);
  }

  const releaseName = options.releaseName || chartDetail.id;
  const namespace = options.namespace || 'default';

  let valuesFlag = '';
  if (options.valuesYaml && options.valuesYaml.trim()) {
    const cacheDir = path.join(projectRoot, '.vow-cache', 'helm');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    const valuesFile = path.join(cacheDir, `temp-${chartId}-values.yaml`);
    fs.writeFileSync(valuesFile, options.valuesYaml, 'utf-8');
    valuesFlag = `-f ${JSON.stringify(valuesFile)}`;
  }

  try {
    const cmd = `helm template ${JSON.stringify(releaseName)} ${JSON.stringify(chartDetail.chartPath)} --namespace ${JSON.stringify(namespace)} ${valuesFlag}`;
    const { stdout } = await execAsync(cmd);
    return stdout;
  } catch (err: any) {
    throw new Error(`Helm template failed: ${err.message}\n${err.stderr || ''}`);
  }
}
