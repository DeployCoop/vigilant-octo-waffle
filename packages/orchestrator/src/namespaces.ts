import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { loadProjectConfig } from './config.js';

const execAsync = promisify(exec);

export type PSSLevel = 'privileged' | 'baseline' | 'restricted';

export interface NamespaceDefinition {
  name: string;
  category: 'core' | 'user' | 'app' | 'storage' | 'security' | 'monitoring' | 'gitops';
  pssEnforce: PSSLevel;
  pssWarn: PSSLevel;
  pssAudit: PSSLevel;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  source?: string;
}

export interface NamespaceDiscoveryResult {
  namespaces: NamespaceDefinition[];
  total: number;
  byCategory: Record<string, string[]>;
}

// System namespaces requiring privileged or relaxed PSS due to host mounts, root privileges, or kernel modules
const PRIVILEGED_NAMESPACES = new Set([
  'kube-system',
  'openebs',
  'nfs-server',
  'longhorn-system',
  'seaweedfs',
  'calico-system',
  'tigera-operator',
  'metallb-system',
  'cert-manager',
  'traefik',
  'ingress-nginx',
]);

const DEFAULT_CORE_NAMESPACES: Array<{ name: string; category: NamespaceDefinition['category'] }> = [
  { name: 'argocd', category: 'gitops' },
  { name: 'flux-system', category: 'gitops' },
  { name: 'monitoring', category: 'monitoring' },
  { name: 'nfs-server', category: 'storage' },
  { name: 'openebs', category: 'storage' },
  { name: 'cert-manager', category: 'security' },
  { name: 'ingress-nginx', category: 'core' },
  { name: 'traefik', category: 'core' },
  { name: 'velero', category: 'security' },
  { name: 'minio', category: 'storage' },
  { name: 'opensearch', category: 'monitoring' },
  { name: 'vault', category: 'security' },
];

/**
 * Discover all namespaces required across the VOW cluster.
 */
export function discoverClusterNamespaces(workspaceRoot: string = process.cwd()): NamespaceDiscoveryResult {
  const envConfig = loadProjectConfig(workspaceRoot);
  const foundNamespaces = new Map<string, NamespaceDefinition>();

  const primaryName = (envConfig.raw?.THIS_NAME || 'example').trim();
  const primaryNs = (envConfig.raw?.THIS_NAMESPACE || envConfig.cluster?.namespace || primaryName).trim();

  // 1. Add primary user namespaces
  foundNamespaces.set(primaryName, {
    name: primaryName,
    category: 'user',
    pssEnforce: 'baseline',
    pssWarn: 'restricted',
    pssAudit: 'restricted',
    source: '.env (THIS_NAME)',
  });

  if (primaryNs !== primaryName) {
    foundNamespaces.set(primaryNs, {
      name: primaryNs,
      category: 'user',
      pssEnforce: 'baseline',
      pssWarn: 'restricted',
      pssAudit: 'restricted',
      source: '.env (THIS_NAMESPACE)',
    });
  }

  // 2. Add standard core infra namespaces
  for (const core of DEFAULT_CORE_NAMESPACES) {
    const isPrivileged = PRIVILEGED_NAMESPACES.has(core.name);
    foundNamespaces.set(core.name, {
      name: core.name,
      category: core.category,
      pssEnforce: isPrivileged ? 'privileged' : 'baseline',
      pssWarn: isPrivileged ? 'baseline' : 'restricted',
      pssAudit: isPrivileged ? 'baseline' : 'restricted',
      source: 'core-definition',
    });
  }

  // 3. Scan argo/ manifests for target namespaces
  const argoDir = path.join(workspaceRoot, 'argo');
  if (fs.existsSync(argoDir)) {
    try {
      const apps = fs.readdirSync(argoDir, { withFileTypes: true });
      for (const app of apps) {
        if (!app.isDirectory()) continue;
        const appFile = path.join(argoDir, app.name, 'argocd.yaml');
        if (fs.existsSync(appFile)) {
          try {
            const content = fs.readFileSync(appFile, 'utf8');
            const parsed = YAML.parse(content) as Record<string, any>;
            const targetNs = parsed?.spec?.destination?.namespace;
            if (targetNs && typeof targetNs === 'string' && !targetNs.startsWith('$') && !targetNs.includes('{')) {
              if (!foundNamespaces.has(targetNs)) {
                const isPriv = PRIVILEGED_NAMESPACES.has(targetNs);
                foundNamespaces.set(targetNs, {
                  name: targetNs,
                  category: 'app',
                  pssEnforce: isPriv ? 'privileged' : 'baseline',
                  pssWarn: isPriv ? 'baseline' : 'restricted',
                  pssAudit: isPriv ? 'baseline' : 'restricted',
                  source: `argo/${app.name}/argocd.yaml`,
                });
              }
            }
          } catch {
            // Ignore parse errors on template yaml
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  // 4. Scan flux/ manifests for target namespaces
  const fluxDir = path.join(workspaceRoot, 'flux');
  if (fs.existsSync(fluxDir)) {
    try {
      const apps = fs.readdirSync(fluxDir, { withFileTypes: true });
      for (const app of apps) {
        if (!app.isDirectory()) continue;
        const appFile = path.join(fluxDir, app.name, 'flux.yaml');
        if (fs.existsSync(appFile)) {
          try {
            const content = fs.readFileSync(appFile, 'utf8');
            const docs = YAML.parseAllDocuments(content).map((d) => d.toJSON()) as Array<Record<string, any>>;
            for (const doc of docs) {
              const targetNs = doc?.spec?.targetNamespace || doc?.metadata?.namespace;
              if (targetNs && typeof targetNs === 'string' && !targetNs.startsWith('$') && !targetNs.includes('{')) {
                if (!foundNamespaces.has(targetNs)) {
                  const isPriv = PRIVILEGED_NAMESPACES.has(targetNs);
                  foundNamespaces.set(targetNs, {
                    name: targetNs,
                    category: 'app',
                    pssEnforce: isPriv ? 'privileged' : 'baseline',
                    pssWarn: isPriv ? 'baseline' : 'restricted',
                    pssAudit: isPriv ? 'baseline' : 'restricted',
                    source: `flux/${app.name}/flux.yaml`,
                  });
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  const namespacesList = Array.from(foundNamespaces.values()).sort((a, b) => a.name.localeCompare(b.name));
  const byCategory: Record<string, string[]> = {};
  for (const ns of namespacesList) {
    if (!byCategory[ns.category]) {
      byCategory[ns.category] = [];
    }
    byCategory[ns.category].push(ns.name);
  }

  return {
    namespaces: namespacesList,
    total: namespacesList.length,
    byCategory,
  };
}

/**
 * Generate a Kubernetes Namespace resource object with PSS annotations/labels.
 */
export function buildNamespaceObject(def: NamespaceDefinition): Record<string, any> {
  const labels: Record<string, string> = {
    'kubernetes.io/metadata.name': def.name,
    'pod-security.kubernetes.io/enforce': def.pssEnforce,
    'pod-security.kubernetes.io/enforce-version': 'latest',
    'pod-security.kubernetes.io/warn': def.pssWarn,
    'pod-security.kubernetes.io/warn-version': 'latest',
    'pod-security.kubernetes.io/audit': def.pssAudit,
    'pod-security.kubernetes.io/audit-version': 'latest',
    'app.kubernetes.io/managed-by': 'vow',
    'vow.dev/category': def.category,
    ...(def.labels || {}),
  };

  const annotations: Record<string, string> = {
    'vow.dev/source': def.source || 'orchestrator',
    ...(def.annotations || {}),
  };

  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: def.name,
      labels,
      annotations,
    },
  };
}

/**
 * Generate a multi-document YAML string representing all cluster namespaces.
 */
export function generateNamespaceManifests(namespaces: NamespaceDefinition[]): string {
  const docs = namespaces.map((ns) => buildNamespaceObject(ns));
  return docs.map((doc) => YAML.stringify(doc)).join('---\n');
}

/**
 * Generate a single namespace YAML manifest with PSS standards.
 */
export function generateSingleNamespaceManifest(
  name: string,
  pssLevel: PSSLevel = PRIVILEGED_NAMESPACES.has(name) ? 'privileged' : 'baseline',
  category: NamespaceDefinition['category'] = 'app',
): string {
  const isPrivileged = pssLevel === 'privileged';
  const def: NamespaceDefinition = {
    name,
    category,
    pssEnforce: pssLevel,
    pssWarn: isPrivileged ? 'baseline' : 'restricted',
    pssAudit: isPrivileged ? 'baseline' : 'restricted',
    source: 'cli',
  };
  return YAML.stringify(buildNamespaceObject(def));
}

/**
 * Ensures a namespace exists with appropriate Pod Security Standards labels.
 */
export async function ensureNamespaceWithSecurity(
  projectRoot: string,
  name: string,
  options?: { enforce?: PSSLevel; warn?: PSSLevel; audit?: PSSLevel; category?: NamespaceDefinition['category'] }
): Promise<void> {
  const pss = options?.enforce || (PRIVILEGED_NAMESPACES.has(name) ? 'privileged' : 'baseline');
  const manifest = generateSingleNamespaceManifest(name, pss, options?.category || 'app');
  await new Promise<void>((resolve, reject) => {
    const proc = exec('kubectl apply -f -', { cwd: projectRoot }, (err) => (err ? reject(err) : resolve()));
    proc.stdin?.write(manifest);
    proc.stdin?.end();
  });
}

export interface NamespaceSyncOptions {
  workspaceRoot?: string;
  dryRun?: boolean;
}

export interface NamespaceSyncResult {
  total: number;
  namespaces: string[];
  applied: boolean;
  manifest: string;
}

/**
 * Discovers and applies all declarative namespaces to the active cluster.
 */
export async function applyClusterNamespaces(
  workspaceRoot: string = process.cwd(),
  options: NamespaceSyncOptions = {},
): Promise<NamespaceSyncResult> {
  const discovery = discoverClusterNamespaces(workspaceRoot);
  const manifest = generateNamespaceManifests(discovery.namespaces);

  if (options.dryRun) {
    return {
      total: discovery.total,
      namespaces: discovery.namespaces.map((n) => n.name),
      applied: false,
      manifest,
    };
  }

  const tmpDir = path.join(workspaceRoot, '.secrets');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const manifestPath = path.join(tmpDir, 'all-cluster-namespaces.yaml');
  fs.writeFileSync(manifestPath, manifest, 'utf8');

  try {
    await execAsync(`kubectl apply -f "${manifestPath}"`);
    return {
      total: discovery.total,
      namespaces: discovery.namespaces.map((n) => n.name),
      applied: true,
      manifest,
    };
  } catch (err: any) {
    return {
      total: discovery.total,
      namespaces: discovery.namespaces.map((n) => n.name),
      applied: false,
      manifest,
    };
  }
}
