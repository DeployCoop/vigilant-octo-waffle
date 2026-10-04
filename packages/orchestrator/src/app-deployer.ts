import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProjectConfig, findProjectRoot } from './config.js';
import { substituteVariables } from './template.js';
import { mergeYamlStrings } from './yaml.js';
import { applyInitializerDirectory } from './initializer.js';
import { ensureNamespaceWithSecurity } from './namespaces.js';

const execAsync = promisify(exec);

export type DeployEngine = 'argocd' | 'helm' | 'flux';

export interface CatalogAppMeta {
  appId: string;
  name: string;
  category: string;
  defaultNamespace: string;
  hasArgoManifest: boolean;
  hasLocalChart: boolean;
  hasInit: boolean;
  enablerVar: string;
}

export interface DeployAppOptions {
  engine?: DeployEngine;
  namespace?: string;
  wait?: boolean;
  timeoutSeconds?: number;
  envOverrides?: Record<string, string | undefined>;
}

export interface DeployAppResult {
  appId: string;
  namespace: string;
  engine: DeployEngine;
  success: boolean;
  message: string;
  error?: string;
  manifestApplied?: boolean;
}

export interface CatalogAppStatus {
  appId: string;
  namespace: string;
  isDeployed: boolean;
  status: 'healthy' | 'progressing' | 'degraded' | 'not-deployed' | 'unknown';
  pods: Array<{ name: string; ready: boolean; status: string; restarts: number }>;
  argoSyncStatus?: string;
  helmReleaseStatus?: string;
}

/**
 * Returns a list of all known applications in the catalog
 */
export function listCatalogApps(projectRoot: string = findProjectRoot()): CatalogAppMeta[] {
  const root = fs.existsSync(path.join(projectRoot, 'argo'))
    ? projectRoot
    : findProjectRoot(projectRoot);
  const argoDir = path.join(root, 'argo');
  const chartsDir = path.join(root, 'charts');
  const initDir = path.join(root, 'init');

  const appIds = new Set<string>();

  if (fs.existsSync(argoDir)) {
    for (const f of fs.readdirSync(argoDir)) {
      if (fs.statSync(path.join(argoDir, f)).isDirectory()) {
        appIds.add(f);
      }
    }
  }

  if (fs.existsSync(chartsDir)) {
    for (const f of fs.readdirSync(chartsDir)) {
      if (fs.statSync(path.join(chartsDir, f)).isDirectory()) {
        appIds.add(f);
      }
    }
  }

  const result: CatalogAppMeta[] = [];

  for (const appId of Array.from(appIds).sort()) {
    const hasArgoManifest = fs.existsSync(path.join(argoDir, appId, 'argocd.yaml'));
    const hasLocalChart = fs.existsSync(path.join(chartsDir, appId, 'Chart.yaml')) || fs.existsSync(path.join(chartsDir, appId, 'Chart.yml'));
    const hasInit = fs.existsSync(path.join(initDir, appId)) || fs.existsSync(path.join(initDir, `pre-${appId}`));

    // Determine category based on app name conventions
    let category = 'Application';
    if (['openebs', 'seaweedfs', 'rook-ceph', 'csi-driver-nfs'].some((s) => appId.includes(s))) {
      category = 'Storage Fabric';
    } else if (['nginx', 'traefik', 'haproxy', 'certmanager', 'mkcert', 'letsencrypt'].some((s) => appId.includes(s))) {
      category = 'Ingress & Network';
    } else if (['prometheus', 'fluent', 'opensearch', 'sloth', 'vigil', 'metrics'].some((s) => appId.includes(s))) {
      category = 'Monitoring & Observability';
    } else if (['mariadb', 'supabase', 'minio', 'redis', 'postgresql', 'kubegres'].some((s) => appId.includes(s))) {
      category = 'Database & State';
    } else if (['gpu-operator', 'nfd-operator', 'operator', 'olm', 'k3ai'].some((s) => appId.includes(s))) {
      category = 'Operators & Hardware';
    } else if (['keycloak', 'openldap', 'bao', 'openbao'].some((s) => appId.includes(s))) {
      category = 'Identity & Security';
    } else if (['ollama', 'vllm', 'cvat', 'kubeflow'].some((s) => appId.includes(s))) {
      category = 'AI / ML Platforms';
    }

    const enablerVar = `THIS_${appId.toUpperCase().replace(/-/g, '_')}_ENABLED`;
    const defaultNamespace = appId.replace(/_/g, '-');

    result.push({
      appId,
      name: appId.charAt(0).toUpperCase() + appId.slice(1).replace(/[-_]/g, ' '),
      category,
      defaultNamespace,
      hasArgoManifest,
      hasLocalChart,
      hasInit,
      enablerVar,
    });
  }

  return result;
}

/**
 * Renders the ArgoCD Application manifest for a specific app with variable substitution and overrides
 */
export function renderAppManifest(
  projectRoot: string,
  appId: string,
  envOverrides?: Record<string, string | undefined>
): string | null {
  const root = fs.existsSync(path.join(projectRoot, 'argo'))
    ? projectRoot
    : findProjectRoot(projectRoot);
  const config = loadProjectConfig(root);
  const env: Record<string, string | undefined> = {
    ...config.raw,
    ...envOverrides,
  };

  const baseManifestPath = path.join(root, 'argo', appId, 'argocd.yaml');
  const overridePath = path.join(root, '.argo_overrides', appId, 'argocd.yaml');

  let rawYaml = '';
  if (fs.existsSync(overridePath)) {
    const overrideYaml = fs.readFileSync(overridePath, 'utf-8');
    if (fs.existsSync(baseManifestPath)) {
      const baseYaml = fs.readFileSync(baseManifestPath, 'utf-8');
      try {
        rawYaml = mergeYamlStrings(baseYaml, overrideYaml);
      } catch {
        rawYaml = overrideYaml;
      }
    } else {
      rawYaml = overrideYaml;
    }
  } else if (fs.existsSync(baseManifestPath)) {
    rawYaml = fs.readFileSync(baseManifestPath, 'utf-8');
  } else {
    return null;
  }

  return substituteVariables(rawYaml, env);
}

/**
 * Unified application lifecycle deployer: supports ArgoCD GitOps, Helm direct, and FluxCD
 */
export async function deployCatalogApp(
  projectRoot: string,
  appId: string,
  options: DeployAppOptions = {}
): Promise<DeployAppResult> {
  const config = loadProjectConfig(projectRoot);
  const engine = options.engine || (config.raw.THIS_CD_RUNNER as DeployEngine) || 'argocd';
  const targetNs = options.namespace || appId.replace(/_/g, '-');

  // 1. Ensure target namespace with Baseline PSS
  await ensureNamespaceWithSecurity(projectRoot, targetNs, {
    enforce: 'baseline',
    audit: 'restricted',
    warn: 'restricted',
  });

  // 2. Pre-initializers (init/pre-<appId>)
  await applyInitializerDirectory(projectRoot, `init/pre-${appId}`);

  // 3. Execution based on engine
  try {
    if (engine === 'argocd') {
      const renderedManifest = renderAppManifest(projectRoot, appId, options.envOverrides);
      if (!renderedManifest) {
        throw new Error(`No ArgoCD manifest found for application '${appId}' in argo/${appId}/argocd.yaml`);
      }

      // Ensure argocd namespace exists
      await ensureNamespaceWithSecurity(projectRoot, 'argocd', {
        enforce: 'baseline',
        audit: 'restricted',
        warn: 'restricted',
      });

      // Apply Application CRD directly to Kubernetes
      await new Promise<void>((resolve, reject) => {
        const proc = exec('kubectl apply -f -', { cwd: projectRoot }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        });
        proc.stdin?.write(renderedManifest);
        proc.stdin?.end();
      });

      // 4. Post-initializers (init/<appId> and init/<appId>_<ingress>)
      await applyInitializerDirectory(projectRoot, `init/${appId}`);
      const ingressType = config.cluster.ingress || config.raw.THIS_CLUSTER_INGRESS || 'traefik';
      await applyInitializerDirectory(projectRoot, `init/${appId}_${ingressType}`);

      return {
        appId,
        namespace: targetNs,
        engine: 'argocd',
        success: true,
        message: `Successfully synchronized ArgoCD Application '${appId}' into namespace '${targetNs}'`,
        manifestApplied: true,
      };
    } else if (engine === 'helm') {
      const chartPath = path.join(projectRoot, 'charts', appId);
      if (!fs.existsSync(chartPath)) {
        throw new Error(`No local Helm chart found for '${appId}' in charts/${appId}`);
      }

      const timeout = `${options.timeoutSeconds || 300}s`;
      const cmd = `helm upgrade --install ${JSON.stringify(appId)} ${JSON.stringify(chartPath)} --namespace ${JSON.stringify(targetNs)} --create-namespace --wait --timeout ${timeout}`;
      const { stdout, stderr } = await execAsync(cmd, { cwd: projectRoot, env: config.raw });

      await applyInitializerDirectory(projectRoot, `init/${appId}`);

      return {
        appId,
        namespace: targetNs,
        engine: 'helm',
        success: true,
        message: `Successfully installed Helm chart '${appId}': ${(stdout + '\n' + stderr).trim()}`,
        manifestApplied: true,
      };
    } else {
      throw new Error(`Unsupported deployment engine: '${engine}'`);
    }
  } catch (err: any) {
    return {
      appId,
      namespace: targetNs,
      engine,
      success: false,
      message: `Failed to deploy application '${appId}'`,
      error: err.message,
    };
  }
}

/**
 * Removes an application by deleting its ArgoCD Application or uninstalling its Helm release
 */
export async function removeCatalogApp(
  projectRoot: string,
  appId: string,
  namespace?: string
): Promise<{ success: boolean; message: string }> {
  const targetNs = namespace || appId.replace(/_/g, '-');
  try {
    // Attempt ArgoCD app removal
    await execAsync(`kubectl delete application ${JSON.stringify(appId)} -n argocd --ignore-not-found`, { cwd: projectRoot }).catch(() => {});
    // Attempt Helm uninstall
    await execAsync(`helm uninstall ${JSON.stringify(appId)} -n ${JSON.stringify(targetNs)} 2>/dev/null || true`, { cwd: projectRoot }).catch(() => {});

    return {
      success: true,
      message: `Application '${appId}' removed from cluster`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to remove application '${appId}': ${err.message}`,
    };
  }
}

/**
 * Retrieves the live status of an application
 */
export async function getCatalogAppStatus(
  projectRoot: string,
  appId: string,
  namespace?: string
): Promise<CatalogAppStatus> {
  const targetNs = namespace || appId.replace(/_/g, '-');

  const result: CatalogAppStatus = {
    appId,
    namespace: targetNs,
    isDeployed: false,
    status: 'not-deployed',
    pods: [],
  };

  try {
    // 1. Check Pods in target namespace
    const { stdout: podsOut } = await execAsync(`kubectl get pods -n ${JSON.stringify(targetNs)} -o json`, { cwd: projectRoot }).catch(() => ({ stdout: '{"items":[]}' }));
    const podsData = JSON.parse(podsOut);

    if (podsData.items && podsData.items.length > 0) {
      result.isDeployed = true;
      result.pods = podsData.items.map((p: any) => {
        const cond = p.status?.conditions?.find((c: any) => c.type === 'Ready');
        const restarts = (p.status?.containerStatuses || []).reduce((acc: number, c: any) => acc + (c.restartCount || 0), 0);
        return {
          name: p.metadata?.name || '',
          ready: cond?.status === 'True',
          status: p.status?.phase || 'Unknown',
          restarts,
        };
      });

      const allReady = result.pods.every((p) => p.ready);
      const anyRunning = result.pods.some((p) => p.status === 'Running');
      if (allReady) result.status = 'healthy';
      else if (anyRunning) result.status = 'progressing';
      else result.status = 'degraded';
    }

    // 2. Check ArgoCD status
    const { stdout: argoOut } = await execAsync(`kubectl get application ${JSON.stringify(appId)} -n argocd -o json`, { cwd: projectRoot }).catch(() => ({ stdout: '' }));
    if (argoOut) {
      result.isDeployed = true;
      const argoData = JSON.parse(argoOut);
      result.argoSyncStatus = argoData.status?.sync?.status || 'Unknown';
    }
  } catch {
    // Cluster offline
  }

  return result;
}
