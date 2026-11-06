import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig, saveEnablerFile } from './config.js';
import { APP_CATALOG, type AppCategory } from './registry.js';
import { assertK8sLabel } from './exec-argv.js';

function quoteYamlSingle(value: string, label: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`Invalid ${label}: must not contain control characters or newlines`);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export interface CustomAppOptions {
  id: string;
  name: string;
  category: AppCategory;
  description: string;
  subdomain?: string;
  port?: number;
  sourceType: 'helm' | 'git';
  repoURL: string;
  chart?: string;
  targetRevision?: string;
  path?: string;
  valuesYaml?: string;
  dependencies?: string[];
  estimatedMemoryMb?: number;
}

export interface CustomAppDefinition extends CustomAppOptions {
  enablerVar: string;
  isCustom: true;
}

export function getCustomAppsFilePath(projectRoot: string): string {
  return path.join(projectRoot, '.custom_apps.json');
}

export function listCustomApps(projectRoot: string): CustomAppDefinition[] {
  const filePath = getCustomAppsFilePath(projectRoot);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function scaffoldCustomApp(
  options: CustomAppOptions,
  projectRoot: string
): { success: boolean; manifestPath: string; app: CustomAppDefinition } {
  const id = (options.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  assertK8sLabel(id, 'application id');

  if (APP_CATALOG.some((a) => a.id === id)) {
    throw new Error(`Cannot scaffold custom app over built-in application '${id}'`);
  }

  const repoURL = quoteYamlSingle(options.repoURL, 'repoURL');
  const chart = quoteYamlSingle(options.chart || id, 'chart');
  const targetRevision = quoteYamlSingle(
    options.targetRevision || (options.sourceType === 'helm' ? 'latest' : 'HEAD'),
    'targetRevision'
  );
  const gitPath = quoteYamlSingle(options.path || '.', 'path');

  const enablerVar = `${id.toUpperCase().replace(/-/g, '_')}_ENABLED`;
  const argoBase = path.resolve(projectRoot, 'argo');
  const argoDir = path.resolve(argoBase, id);
  if (!argoDir.startsWith(argoBase + path.sep)) {
    throw new Error('Invalid application path');
  }

  if (fs.existsSync(argoDir)) {
    throw new Error(`Application directory argo/${id} already exists`);
  }

  fs.mkdirSync(argoDir, { recursive: true });

  // Generate ArgoCD Application manifest
  let sourceBlock: string;
  if (options.sourceType === 'helm') {
    sourceBlock = `  source:
    repoURL: ${repoURL}
    chart: ${chart}
    targetRevision: ${targetRevision}
    helm:
      values: |
${(options.valuesYaml || '# Custom values\n')
  .split('\n')
  .map((l) => `        ${l}`)
  .join('\n')}`;
  } else {
    sourceBlock = `  source:
    repoURL: ${repoURL}
    targetRevision: ${targetRevision}
    path: ${gitPath}`;
  }

  const manifestContent = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ${id}-\${THIS_NAMESPACE}
  namespace: argocd
spec:
  project: default
  destination:
    namespace: \${THIS_NAMESPACE}
    server: https://kubernetes.default.svc
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
${sourceBlock}
`;

  const manifestPath = path.join(argoDir, 'argocd.yaml');
  fs.writeFileSync(manifestPath, manifestContent, 'utf-8');

  // Update .env.enabler
  const config = loadProjectConfig(projectRoot);
  const updatedEnablers = {
    ...config.enablers,
    [enablerVar]: true,
  };
  saveEnablerFile(projectRoot, updatedEnablers);

  // Update .custom_apps.json
  const existing = listCustomApps(projectRoot);
  const customApp: CustomAppDefinition = {
    ...options,
    id,
    enablerVar,
    isCustom: true,
  };
  const filtered = existing.filter((a) => a.id !== id);
  filtered.push(customApp);

  fs.writeFileSync(getCustomAppsFilePath(projectRoot), JSON.stringify(filtered, null, 2), 'utf-8');

  return {
    success: true,
    manifestPath,
    app: customApp,
  };
}

export function deleteCustomApp(id: string, projectRoot: string): void {
  assertK8sLabel(id, 'application id');

  if (APP_CATALOG.some((a) => a.id === id)) {
    throw new Error(`Cannot delete built-in application '${id}'`);
  }

  const argoBase = path.resolve(projectRoot, 'argo');
  const argoDir = path.resolve(argoBase, id);
  if (!argoDir.startsWith(argoBase + path.sep)) {
    throw new Error('Invalid application path');
  }

  if (fs.existsSync(argoDir)) {
    fs.rmSync(argoDir, { recursive: true, force: true });
  }

  const enablerVar = `${id.toUpperCase().replace(/-/g, '_')}_ENABLED`;
  const config = loadProjectConfig(projectRoot);
  const updatedEnablers = { ...config.enablers };
  delete updatedEnablers[enablerVar];
  saveEnablerFile(projectRoot, updatedEnablers);

  const existing = listCustomApps(projectRoot);
  const filtered = existing.filter((a) => a.id !== id);
  fs.writeFileSync(getCustomAppsFilePath(projectRoot), JSON.stringify(filtered, null, 2), 'utf-8');
}
