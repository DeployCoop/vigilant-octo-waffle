import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { loadProjectConfig } from './config.js';
import { toBase64 } from './secrets.js';

const execAsync = promisify(exec);

export interface ModularBundleDefinition {
  id: string;
  name: string;
  description: string;
  targetNamespaces: string[];
  keys: string[];
}

export const MODULAR_SECRET_BUNDLES: ModularBundleDefinition[] = [
  {
    id: 'core',
    name: 'core-secrets',
    description: 'ArgoCD admin, cluster admin tokens, and UI login credentials',
    targetNamespaces: ['argocd', 'flux-system'],
    keys: ['argocdadmin-password', 'collabora-username', 'collabora-password'],
  },
  {
    id: 'db',
    name: 'db-secrets',
    description: 'PostgreSQL admin passwords, replication user, and cache passwords',
    targetNamespaces: ['airflow', 'openproject', 'nextcloud', 'drupal'],
    keys: [
      'db-admin-pass',
      'nc-db-password',
      'nc-db-hostname',
      'nc-db-name',
      'nc-db-username',
      'op-db-password',
      'airflow-db-password',
      'redis-pass',
      'replicationUserPassword',
    ],
  },
  {
    id: 'smtp',
    name: 'smtp-secrets',
    description: 'SMTP host, credentials, and outbound email configuration',
    targetNamespaces: ['airflow', 'openproject', 'nextcloud', 'monitoring'],
    keys: ['smtp-username', 'smtp-password', 'smtp-host'],
  },
  {
    id: 'apps',
    name: 'app-secrets',
    description: 'Service-specific admin accounts and initial tokens',
    targetNamespaces: ['harbor', 'opensearch', 'minio'],
    keys: [
      'nextcloud-username',
      'nextcloud-password',
      'nextcloud-token',
      'HARBOR_ADMIN_PASSWORD',
      'OPENSEARCH_INITIAL_ADMIN_PASSWORD',
    ],
  },
];

export interface SecretSyncResult {
  secretName: string;
  sourceNamespace: string;
  syncedNamespaces: string[];
  skippedNamespaces: string[];
  errors: Array<{ namespace: string; error: string }>;
  manifestsGenerated: string[];
}

export interface NamespaceSecretStatus {
  namespace: string;
  exists: boolean;
  hasSecret: boolean;
  secretName: string;
  secretAge?: string;
}

/**
 * Parses a Kubernetes Secret YAML file and extracts its key-value pairs (decoded from base64)
 */
export function parseSecretYaml(filePath: string): {
  name: string;
  namespace: string;
  data: Record<string, string>;
  rawYaml: string;
} | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const rawYaml = fs.readFileSync(filePath, 'utf-8');
    const parsed = YAML.parse(rawYaml);
    if (!parsed || parsed.kind !== 'Secret') return null;

    const name = parsed.metadata?.name || 'unknown';
    const namespace = parsed.metadata?.namespace || 'default';
    const data: Record<string, string> = {};

    if (parsed.data && typeof parsed.data === 'object') {
      for (const [k, v] of Object.entries(parsed.data)) {
        if (typeof v === 'string') {
          data[k] = Buffer.from(v, 'base64').toString('utf-8');
        }
      }
    } else if (parsed.stringData && typeof parsed.stringData === 'object') {
      for (const [k, v] of Object.entries(parsed.stringData)) {
        if (typeof v === 'string') {
          data[k] = v;
        }
      }
    }

    return { name, namespace, data, rawYaml };
  } catch {
    return null;
  }
}

/**
 * Builds a Kubernetes Secret manifest for a target namespace with Reflector annotations
 */
export function buildSecretManifest(options: {
  secretName: string;
  namespace: string;
  data: Record<string, string>;
  enableReflector?: boolean;
  allowedReflectionNamespaces?: string;
}): string {
  const { secretName, namespace, data, enableReflector, allowedReflectionNamespaces = '*' } = options;

  let annotationsBlock = '';
  if (enableReflector) {
    annotationsBlock = `  annotations:
    reflector.v1.k8s.emberstack.com/reflection-allowed: "true"
    reflector.v1.k8s.emberstack.com/reflection-auto-enabled: "true"
    reflector.v1.k8s.emberstack.com/reflection-allowed-namespaces: "${allowedReflectionNamespaces}"
`;
  }

  let yaml = `apiVersion: v1
kind: Secret
metadata:
  name: ${secretName}
  namespace: ${namespace}
${annotationsBlock}type: Opaque
data:
`;

  for (const [k, v] of Object.entries(data)) {
    yaml += `  ${k}: ${toBase64(v)}\n`;
  }

  return yaml;
}

/**
 * Discovers target namespaces across .env.enabler, active apps, and defaults
 */
export function discoverTargetNamespaces(projectRoot: string): string[] {
  const config = loadProjectConfig(projectRoot);
  const primaryNs = config.cluster.namespace || config.raw['THIS_NAME'] || 'default';
  const nameNs = config.raw['THIS_NAME'] || 'monitaur';

  const set = new Set<string>();
  set.add(primaryNs);
  set.add(nameNs);
  set.add('monitoring');
  set.add('nfs-server');
  set.add('cert-manager');

  if (config.enablers['AIRFLOW_ENABLED']) set.add('airflow');
  if (config.enablers['HARBOR_ENABLED']) set.add('harbor');
  if (config.enablers['OPENSEARCH_ENABLED']) set.add('opensearch');
  if (config.enablers['MINIO_TENANT_ENABLED'] || config.enablers['MINIO_OPERATOR_ENABLED']) set.add('minio');
  if (config.enablers['VELERO_ENABLED']) set.add('velero');
  if (config.enablers['VAULT_ENABLED'] || config.enablers['BAO_ENABLED']) set.add('vault');
  if (config.cluster.cdRunner === 'argocd' || config.cluster.cdRunner === 'both') set.add('argocd');
  if (config.cluster.cdRunner === 'flux' || config.cluster.cdRunner === 'both') set.add(config.cluster.fluxNamespace || 'flux-system');

  return Array.from(set).filter((ns) => Boolean(ns) && ns.trim().length > 0);
}

/**
 * Generates modular secret bundles and optionally writes them to .secrets/
 */
export function generateModularSecretBundles(projectRoot: string): {
  bundles: Array<{
    id: string;
    fileName: string;
    manifest: string;
    secretName: string;
    targetNamespaces: string[];
  }>;
  monolithicManifest: string;
} {
  const config = loadProjectConfig(projectRoot);
  const primaryNs = config.cluster.namespace || config.raw['THIS_NAME'] || 'monitaur';
  const secretBaseName = config.raw['THIS_SECRETS'] || `${config.raw['THIS_NAME'] || 'monitaur'}-secrets`;

  const secretsDir = path.join(projectRoot, '.secrets');
  const monolithicPath = path.join(secretsDir, `${secretBaseName}.yaml`);

  // Read existing master secret data or synthesize
  let masterData: Record<string, string> = {};
  const parsed = parseSecretYaml(monolithicPath);
  if (parsed) {
    masterData = parsed.data;
  } else {
    // fallback check for example-secrets.yaml or monitaur-secrets.yaml
    const altPath = path.join(secretsDir, 'monitaur-secrets.yaml');
    const altParsed = parseSecretYaml(altPath);
    if (altParsed) masterData = altParsed.data;
  }

  const bundles = MODULAR_SECRET_BUNDLES.map((bundleDef) => {
    const bundleSecretName = `${config.raw['THIS_NAME'] || 'monitaur'}-${bundleDef.name}`;
    const bundleData: Record<string, string> = {};
    for (const key of bundleDef.keys) {
      if (masterData[key]) {
        bundleData[key] = masterData[key];
      }
    }

    const manifest = buildSecretManifest({
      secretName: bundleSecretName,
      namespace: primaryNs,
      data: bundleData,
      enableReflector: true,
      allowedReflectionNamespaces: bundleDef.targetNamespaces.join(','),
    });

    return {
      id: bundleDef.id,
      fileName: `${bundleSecretName}.yaml`,
      manifest,
      secretName: bundleSecretName,
      targetNamespaces: bundleDef.targetNamespaces,
    };
  });

  const monolithicManifest = buildSecretManifest({
    secretName: secretBaseName,
    namespace: primaryNs,
    data: masterData,
    enableReflector: true,
    allowedReflectionNamespaces: '*',
  });

  return { bundles, monolithicManifest };
}

/**
 * Synchronizes secrets to target namespaces directly via kubectl or outputs the sync plans
 */
export async function syncSecretsAcrossNamespaces(
  projectRoot: string,
  options: {
    targetNamespaces?: string[];
    applyLiveCluster?: boolean;
    secretFile?: string;
  } = {}
): Promise<SecretSyncResult> {
  const config = loadProjectConfig(projectRoot);
  const primaryNs = config.cluster.namespace || config.raw['THIS_NAME'] || 'monitaur';
  const secretBaseName = config.raw['THIS_SECRETS'] || `${config.raw['THIS_NAME'] || 'monitaur'}-secrets`;

  const secretsDir = path.join(projectRoot, '.secrets');
  const sourceSecretPath = options.secretFile
    ? (path.isAbsolute(options.secretFile) ? options.secretFile : path.join(projectRoot, options.secretFile))
    : path.join(secretsDir, `${secretBaseName}.yaml`);

  const parsed = parseSecretYaml(sourceSecretPath);
  const masterData = parsed ? parsed.data : {};

  const targets = options.targetNamespaces && options.targetNamespaces.length > 0
    ? options.targetNamespaces
    : discoverTargetNamespaces(projectRoot);

  const syncedNamespaces: string[] = [];
  const skippedNamespaces: string[] = [];
  const errors: Array<{ namespace: string; error: string }> = [];
  const manifestsGenerated: string[] = [];

  for (const ns of targets) {
    const manifest = buildSecretManifest({
      secretName: secretBaseName,
      namespace: ns,
      data: masterData,
      enableReflector: true,
    });
    manifestsGenerated.push(manifest);

    if (options.applyLiveCluster) {
      try {
        // Ensure namespace exists first
        await execAsync(`kubectl get namespace ${JSON.stringify(ns)} 2>/dev/null || kubectl create namespace ${JSON.stringify(ns)}`);
        
        // Apply secret into namespace
        const child = exec(`kubectl apply -f -`);
        if (child.stdin) {
          child.stdin.write(manifest);
          child.stdin.end();
        }
        await new Promise((resolve, reject) => {
          child.on('close', (code) => {
            if (code === 0) resolve(true);
            else reject(new Error(`kubectl exited with code ${code}`));
          });
          child.on('error', reject);
        });

        syncedNamespaces.push(ns);
      } catch (err: any) {
        errors.push({ namespace: ns, error: err.message });
      }
    } else {
      syncedNamespaces.push(ns);
    }
  }

  return {
    secretName: secretBaseName,
    sourceNamespace: primaryNs,
    syncedNamespaces,
    skippedNamespaces,
    errors,
    manifestsGenerated,
  };
}
