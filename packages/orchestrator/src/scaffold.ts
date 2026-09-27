import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProjectConfig, saveEnablerFile } from './config.js';
import type { AppCategory } from './registry.js';

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
  const id = options.id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  if (!id) {
    throw new Error('Invalid application identifier');
  }

  const enablerVar = `${id.toUpperCase().replace(/-/g, '_')}_ENABLED`;
  const argoDir = path.join(projectRoot, 'argo', id);

  if (fs.existsSync(argoDir)) {
    throw new Error(`Application directory argo/${id} already exists`);
  }

  fs.mkdirSync(argoDir, { recursive: true });

  // Generate ArgoCD Application manifest
  let sourceBlock = '';
  if (options.sourceType === 'helm') {
    sourceBlock = `  source:
    repoURL: '${options.repoURL}'
    chart: '${options.chart || id}'
    targetRevision: '${options.targetRevision || 'latest'}'
    helm:
      values: |
${(options.valuesYaml || '# Custom values\n')
  .split('\n')
  .map((l) => `        ${l}`)
  .join('\n')}`;
  } else {
    sourceBlock = `  source:
    repoURL: '${options.repoURL}'
    targetRevision: '${options.targetRevision || 'HEAD'}'
    path: '${options.path || '.'}'`;
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
  const argoDir = path.join(projectRoot, 'argo', id);
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
