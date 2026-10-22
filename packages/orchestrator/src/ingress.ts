import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProjectConfig } from './config.js';
import { substituteVariables } from './template.js';
import { applyInitializerDirectory } from './initializer.js';
import { ensureNamespaceWithSecurity } from './namespaces.js';

const execAsync = promisify(exec);
import { execFileAsync, ExecArgvError } from './exec-argv.js';
import * as k8s from '@kubernetes/client-node';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// execFileAsync failures carry the child's stderr on ExecArgvError; any
// other error contributes no stderr (matching the old `err.stderr || ''`).
function errorStderr(err: unknown): string {
  return err instanceof ExecArgvError ? err.stderr : '';
}

// Wire shape for the cert-manager ClusterIssuer objects read in
// getIngressFabricStatus (kubectl JSON of a custom resource).
interface ClusterIssuerObject {
  metadata?: { name?: string };
  spec?: {
    acme?: unknown;
    ca?: unknown;
  };
  status?: {
    conditions?: Array<{
      type?: string;
      status?: string;
      message?: string;
      reason?: string;
    }>;
  };
}

function getIngressExecutionEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
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

export type IngressProvider = 'traefik' | 'nginx' | 'haproxy';

export interface IngressDeploymentResult {
  provider: IngressProvider;
  success: boolean;
  message: string;
  output?: string;
  error?: string;
}

export interface CertManagerStatus {
  isInstalled: boolean;
  version?: string;
  podsReady: boolean;
  issuers: Array<{ name: string; type: string; ready: boolean; status: string }>;
}

export interface IngressFabricStatus {
  activeProvider: string;
  isControllerReady: boolean;
  ingressClasses: string[];
  certManager: CertManagerStatus;
  ingresses: Array<{ name: string; namespace: string; host: string; class: string }>;
}

/**
 * Installs or upgrades Jetstack Cert-Manager Helm release with CRDs
 */
export async function deployCertManager(
  projectRoot: string,
  options: {
    version?: string;
    timeout?: string;
  } = {}
): Promise<{ success: boolean; output: string }> {
  const config = loadProjectConfig(projectRoot);
  const version = options.version || config.raw.CERT_MANAGER_VERSION || 'v1.16.3';
  const timeout = options.timeout || config.raw.THIS_HELM_TIMEOUT || '15m0s';

  // Ensure namespace with restricted PSS
  await ensureNamespaceWithSecurity(projectRoot, 'cert-manager', {
    enforce: 'baseline',
    audit: 'restricted',
    warn: 'restricted',
  });

  const cmdArgs = [
    'upgrade', '--install', 'cert-manager', 'cert-manager',
    '--repo', 'https://charts.jetstack.io',
    '--namespace', 'cert-manager',
    '--create-namespace',
    '--wait',
    '--timeout', timeout,
    '--version', version,
    '--set', 'prometheus.enabled=true',
    '--set', 'crds.enabled=true',
  ];

  try {
    const { stdout, stderr } = await execFileAsync('helm', cmdArgs, { cwd: projectRoot, env: getIngressExecutionEnv(config.raw) });
    return {
      success: true,
      output: (stdout + '\n' + stderr).trim(),
    };
  } catch (err) {
    throw new Error(`Cert-Manager installation failed: ${errorMessage(err)}\n${errorStderr(err)}`, { cause: err });
  }
}

/**
 * Configures local mkcert root CA as a ClusterIssuer in cert-manager
 */
export async function setupMkcert(
  projectRoot: string
): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout: caroot } = await execAsync('mkcert -CAROOT');
    const caDir = caroot.trim();
    const keyPath = path.join(caDir, 'rootCA-key.pem');
    const certPath = path.join(caDir, 'rootCA.pem');

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      throw new Error(`mkcert CA root files not found in ${caDir}`);
    }

    // Create or update secret idempotently via client-side dry-run pipe
    const secretManifest = await execFileAsync('kubectl', [
      'create', 'secret', 'tls', 'mkcert-ca-key-pair',
      '--key', keyPath, '--cert', certPath,
      '-n', 'cert-manager', '--dry-run=client', '-o', 'yaml',
    ], { cwd: projectRoot }).then((r) => r.stdout).catch(() => '');
        if (secretManifest) {
      await execFileAsync('kubectl', ['apply', '-f', '-'], { cwd: projectRoot, input: secretManifest });
    }

    // Apply init/certmanager-mkcert manifests
    await applyInitializerDirectory(projectRoot, 'init/certmanager-mkcert');

    return {
      success: true,
      output: 'Successfully installed mkcert CA secret and ClusterIssuer mkcert-issuer',
    };
  } catch (err) {
    throw new Error(`mkcert setup failed: ${errorMessage(err)}`, { cause: err });
  }
}

/**
 * Configures Let's Encrypt Staging and Production ClusterIssuers
 */
export async function setupLetsEncrypt(
  projectRoot: string
): Promise<{ success: boolean; output: string }> {
  try {
    const res = await applyInitializerDirectory(projectRoot, 'init/certmanager-LE');
    if (!res.success) {
      throw new Error(`Failed to apply Let's Encrypt manifests: ${JSON.stringify(res.appliedFiles)}`);
    }
    return {
      success: true,
      output: 'Successfully applied Let\'s Encrypt staging and production ClusterIssuers',
    };
  } catch (err) {
    throw new Error(`Let's Encrypt setup failed: ${errorMessage(err)}`, { cause: err });
  }
}

/**
 * Deploys Ingress-Nginx controller
 */
export async function deployIngressNginx(
  projectRoot: string,
  options: {
    minimal?: boolean;
    mqtt?: boolean;
    timeout?: string;
  } = {}
): Promise<IngressDeploymentResult> {
  const config = loadProjectConfig(projectRoot);
  const timeout = options.timeout || config.raw.THIS_HELM_TIMEOUT || '15m0s';

  // Ensure namespace
  await ensureNamespaceWithSecurity(projectRoot, 'ingress-nginx', {
    enforce: 'baseline',
    audit: 'restricted',
    warn: 'restricted',
  });

  // Apply pre-init manifests if present
  await applyInitializerDirectory(projectRoot, 'init/pre-nginx');

  // Apply raymii mosquitto configmap if mqtt enabled
  const mosquittoCm = path.join(projectRoot, 'init/raymii-mosquitto_nginx/configmap.yaml');
  if (options.mqtt && fs.existsSync(mosquittoCm)) {
    await execFileAsync('kubectl', ['apply', '-f', mosquittoCm], { cwd: projectRoot }).catch(() => {});
  }

  // Determine values template
  let tplName = 'ingress-nginx-values.tpl';
  if (options.minimal) tplName = 'ingress-nginx-minimal-values.tpl';
  else if (options.mqtt) tplName = 'ingress-nginx-mqtt-values.tpl';

  const tplPath = path.join(projectRoot, 'src', tplName);
  let valuesYaml = '';
  if (fs.existsSync(tplPath)) {
    const raw = fs.readFileSync(tplPath, 'utf-8');
    valuesYaml = substituteVariables(raw, config.raw, { preserveUnknown: true });
  }

  const cacheDir = path.join(projectRoot, '.vow-cache', 'ingress');
  fs.mkdirSync(cacheDir, { recursive: true });
  const valuesFile = path.join(cacheDir, 'nginx-values.yaml');
  fs.writeFileSync(valuesFile, valuesYaml, 'utf-8');

  const cmdArgs = [
    'upgrade', '--install', 'ingress-nginx', 'ingress-nginx',
    '--repo', 'https://kubernetes.github.io/ingress-nginx',
    '--namespace', 'ingress-nginx',
    '--create-namespace',
    '--wait',
    '--timeout', timeout,
    '-f', valuesFile,
  ];

  try {
    const { stdout, stderr } = await execFileAsync('helm', cmdArgs, { cwd: projectRoot, env: getIngressExecutionEnv(config.raw) });
    return {
      provider: 'nginx',
      success: true,
      message: 'Ingress-Nginx deployed successfully',
      output: (stdout + '\n' + stderr).trim(),
    };
  } catch (err) {
    return {
      provider: 'nginx',
      success: false,
      message: 'Ingress-Nginx deployment failed',
      error: errorMessage(err) + '\n' + errorStderr(err),
    };
  }
}

/**
 * Deploys Traefik controller
 */
export async function deployTraefik(
  projectRoot: string,
  options: {
    method?: 'helm' | 'init' | 'main';
    timeout?: string;
  } = {}
): Promise<IngressDeploymentResult> {
  const config = loadProjectConfig(projectRoot);
  const rawMethod = config.raw.THIS_TRAEFIK_METHOD;
  const method = options.method || (rawMethod === 'init' || rawMethod === 'main' ? rawMethod : 'helm');
  const timeout = options.timeout || config.raw.THIS_HELM_TIMEOUT || '15m0s';

  // Ensure namespace
  await ensureNamespaceWithSecurity(projectRoot, 'traefik', {
    enforce: 'baseline',
    audit: 'restricted',
    warn: 'restricted',
  });

  // Apply Traefik CRDs and RBAC
  try {
    await execAsync('kubectl apply -f https://raw.githubusercontent.com/traefik/traefik/v3.5/docs/content/reference/dynamic-configuration/kubernetes-crd-definition-v1.yml', { cwd: projectRoot });
    await execAsync('kubectl apply -f https://raw.githubusercontent.com/traefik/traefik/v3.5/docs/content/reference/dynamic-configuration/kubernetes-crd-rbac.yml', { cwd: projectRoot });
  } catch {
    // If offline or already applied, proceed
  }

  // Apply middlewares
  await applyInitializerDirectory(projectRoot, 'init/middlewares');

  if (method === 'init') {
    const res = await applyInitializerDirectory(projectRoot, 'init/traefik');
    return {
      provider: 'traefik',
      success: res.success,
      message: res.success ? 'Traefik manifests applied from init/traefik' : 'Failed to apply init/traefik',
    };
  }

  // Helm installation
  const tplPath = path.join(projectRoot, 'src', 'ingress-traefik-values.tpl');
  let valuesYaml = '';
  if (fs.existsSync(tplPath)) {
    const raw = fs.readFileSync(tplPath, 'utf-8');
    valuesYaml = substituteVariables(raw, config.raw, { preserveUnknown: true });
  }

  const cacheDir = path.join(projectRoot, '.vow-cache', 'ingress');
  fs.mkdirSync(cacheDir, { recursive: true });
  const valuesFile = path.join(cacheDir, 'traefik-values.yaml');
  fs.writeFileSync(valuesFile, valuesYaml, 'utf-8');

  const cmdArgs = [
    'upgrade', '--install', 'traefik', 'traefik',
    '--repo', 'https://traefik.github.io/charts',
    '--namespace', 'traefik',
    '--create-namespace',
    '--wait',
    '--timeout', timeout,
    '-f', valuesFile,
  ];

  try {
    const { stdout, stderr } = await execFileAsync('helm', cmdArgs, { cwd: projectRoot, env: getIngressExecutionEnv(config.raw) });
    return {
      provider: 'traefik',
      success: true,
      message: 'Traefik deployed successfully via Helm',
      output: (stdout + '\n' + stderr).trim(),
    };
  } catch (err) {
    return {
      provider: 'traefik',
      success: false,
      message: 'Traefik deployment failed',
      error: errorMessage(err) + '\n' + errorStderr(err),
    };
  }
}

/**
 * Deploys HAProxy Ingress controller
 */
export async function deployHAProxy(
  projectRoot: string,
  options: {
    mqtt?: boolean;
    timeout?: string;
  } = {}
): Promise<IngressDeploymentResult> {
  const config = loadProjectConfig(projectRoot);
  const timeout = options.timeout || config.raw.THIS_HELM_TIMEOUT || '15m0s';

  // Ensure namespace
  await ensureNamespaceWithSecurity(projectRoot, 'ingress-haproxy', {
    enforce: 'baseline',
    audit: 'restricted',
    warn: 'restricted',
  });

  const tplName = options.mqtt ? 'ingress-haproxy-mqtt-values.tpl' : 'ingress-haproxy-values.tpl';
  const tplPath = path.join(projectRoot, 'src', tplName);
  let valuesYaml = '';
  if (fs.existsSync(tplPath)) {
    const raw = fs.readFileSync(tplPath, 'utf-8');
    valuesYaml = substituteVariables(raw, config.raw, { preserveUnknown: true });
  }

  const cacheDir = path.join(projectRoot, '.vow-cache', 'ingress');
  fs.mkdirSync(cacheDir, { recursive: true });
  const valuesFile = path.join(cacheDir, 'haproxy-values.yaml');
  fs.writeFileSync(valuesFile, valuesYaml, 'utf-8');

  const cmdArgs = [
    'upgrade', '--install', 'haproxy-kubernetes-ingress', 'kubernetes-ingress',
    '--repo', 'https://haproxytech.github.io/helm-charts',
    '--wait',
    '--timeout', timeout,
    '--set', 'controller.image.tag=3.0',
    '--namespace', 'ingress-haproxy',
    '--create-namespace',
    '-f', valuesFile,
  ];

  try {
    const { stdout, stderr } = await execFileAsync('helm', cmdArgs, { cwd: projectRoot, env: getIngressExecutionEnv(config.raw) });
    return {
      provider: 'haproxy',
      success: true,
      message: 'HAProxy Ingress deployed successfully',
      output: (stdout + '\n' + stderr).trim(),
    };
  } catch (err) {
    return {
      provider: 'haproxy',
      success: false,
      message: 'HAProxy Ingress deployment failed',
      error: errorMessage(err) + '\n' + errorStderr(err),
    };
  }
}

/**
 * Top-level ingress fabric bring-up: deploys Cert-Manager, certificates, and the configured ingress controller
 */
export async function deployIngressFabric(
  projectRoot: string
): Promise<IngressDeploymentResult> {
  const config = loadProjectConfig(projectRoot);
  const provider = (config.cluster.ingress || config.raw.THIS_CLUSTER_INGRESS || 'traefik').toLowerCase() as IngressProvider;

  // 1. Deploy CertManager if enabled
  try {
    await deployCertManager(projectRoot);
  } catch {
    // Continue even if cert-manager had warnings or is already present
  }

  // 2. Setup certificates
  const certType = config.raw.THIS_CLUSTER_ISSUER || 'mkcert-issuer';
  if (certType.includes('mkcert')) {
    try {
      await setupMkcert(projectRoot);
    } catch {
      // mkcert CA might be local-only
    }
  } else if (certType.includes('letsencrypt')) {
    try {
      await setupLetsEncrypt(projectRoot);
    } catch {
      // LE issuers setup
    }
  }

  // 3. Deploy selected ingress provider
  switch (provider) {
    case 'nginx':
      return deployIngressNginx(projectRoot);
    case 'haproxy':
      return deployHAProxy(projectRoot);
    case 'traefik':
    default:
      return deployTraefik(projectRoot);
  }
}

/**
 * Retrieves the current status of Ingress and TLS across the cluster
 */
export async function getIngressFabricStatus(projectRoot: string): Promise<IngressFabricStatus> {
  const config = loadProjectConfig(projectRoot);
  const activeProvider = config.cluster.ingress || config.raw.THIS_CLUSTER_INGRESS || 'traefik';

  let isControllerReady = false;
  let ingressClasses: string[] = [];
  const ingresses: Array<{ name: string; namespace: string; host: string; class: string }> = [];
  const certManager: CertManagerStatus = {
    isInstalled: false,
    podsReady: false,
    issuers: [],
  };

  try {
    // Check Ingress Classes
    const { stdout: icOut } = await execAsync('kubectl get ingressclass -o json').catch(() => ({ stdout: '{"items":[]}' }));
    const icData = JSON.parse(icOut) as k8s.V1IngressClassList;
    ingressClasses = (icData.items || []).map((i) => i.metadata?.name || '');

    // Check Ingresses
    const { stdout: ingOut } = await execAsync('kubectl get ingress -A -o json').catch(() => ({ stdout: '{"items":[]}' }));
    const ingData = JSON.parse(ingOut) as k8s.V1IngressList;
    for (const item of ingData.items || []) {
      const name = item.metadata?.name || '';
      const namespace = item.metadata?.namespace || '';
      const cls = item.spec?.ingressClassName || '';
      const host = item.spec?.rules?.[0]?.host || '*';
      ingresses.push({ name, namespace, host, class: cls });
    }

    // Check CertManager deployment
    const { stdout: cmOut } = await execAsync('kubectl get deployment cert-manager -n cert-manager -o json').catch(() => ({ stdout: '' }));
    if (cmOut) {
      certManager.isInstalled = true;
      const cmData = JSON.parse(cmOut) as k8s.V1Deployment;
      const readyReplicas = cmData.status?.readyReplicas || 0;
      certManager.podsReady = readyReplicas > 0;
    }

    // Check ClusterIssuers
    const { stdout: ciOut } = await execAsync('kubectl get clusterissuer -o json').catch(() => ({ stdout: '{"items":[]}' }));
    const ciData = JSON.parse(ciOut) as { items?: ClusterIssuerObject[] };
    certManager.issuers = (ciData.items || []).map((i) => {
      const cond = i.status?.conditions?.find((c) => c.type === 'Ready');
      return {
        name: i.metadata?.name || '',
        type: i.spec?.acme ? 'ACME' : i.spec?.ca ? 'CA' : 'SelfSigned',
        ready: cond?.status === 'True',
        status: cond?.message || cond?.reason || 'Unknown',
      };
    });

    // Check active controller readiness
    const ns = activeProvider === 'nginx' ? 'ingress-nginx' : activeProvider === 'haproxy' ? 'ingress-haproxy' : 'traefik';
    const { stdout: podsOut } = await execFileAsync('kubectl', ['get', 'pods', '-n', ns, '-o', 'json']).catch(() => ({ stdout: '{"items":[]}' }));
    const podsData = JSON.parse(podsOut) as k8s.V1PodList;
    isControllerReady = (podsData.items || []).some((p) => p.status?.phase === 'Running');
  } catch {
    // Cluster offline
  }

  return {
    activeProvider,
    isControllerReady,
    ingressClasses,
    certManager,
    ingresses,
  };
}
