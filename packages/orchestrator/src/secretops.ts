import { K8sClient } from './k8s.js';
import { ClusterUnavailableError } from './errors.js';
import type {
  ClusterTelemetry,
  ConfigMapInfo,
  ExternalSecretsStatus,
  PodSpecInfo,
  SecretDetail,
  SecretInfo,
} from './k8s.js';
import {
  assertCommandSuccess,
  processManager,
  type CommandWaitResult,
  type RunCommandOptions,
} from './executor.js';
import { generateRandomSecret } from './secrets.js';

/**
 * SecretOps, wired to the real cluster (Batch C).
 *
 * The audit reads live Secrets, ConfigMaps, and pod specs through the
 * K8s client and scans them for leaked credentials; rotation patches a
 * real Secret, restarts the workloads that consume it, and verifies the
 * rollout before reporting success. No cluster → ClusterUnavailableError
 * (the route maps it to 503); nothing here fabricates data.
 *
 * Secret values are handled under a strict rule: they are examined in
 * memory only for pattern matching and manifest rebuilds, and never
 * logged, persisted, or returned. The report carries masked values
 * (first 4 + last 4 chars) and metadata only. Rotation patches via
 * `kubectl apply -f -` over stdin — never via argv: the executor
 * persists the redacted command line to the task store, and its
 * redactor covers only `--token` values, so a secret value in a
 * `kubectl patch -p` argument would leak into the tasks API.
 */

export interface SecretLeakFinding {
  id: string;
  workloadName: string;
  namespace: string;
  targetType: 'POD_ENV' | 'CONFIGMAP' | 'CONTAINER_ARG' | 'LOG_STDOUT';
  key: string;
  maskedValue: string;
  detectedType: 'AWS_KEY' | 'PRIVATE_KEY' | 'GITHUB_TOKEN' | 'DATABASE_PASSWORD' | 'GENERIC_HIGH_ENTROPY';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  recommendation: string;
}

export interface SecretHygieneRecord {
  secretName: string;
  namespace: string;
  type: string;
  ageDays: number;
  lastRotated: string;
  status: 'HEALTHY' | 'WARNING' | 'EXPIRED_ROTATION_NEEDED';
  managedBy: 'Manual' | 'ArgoCD' | 'ESO / Vault' | 'cert-manager';
}

export interface SecretOpsReport {
  totalSecrets: number;
  leaksDetected: SecretLeakFinding[];
  hygieneRecords: SecretHygieneRecord[];
  staleSecretCount: number;
  externalVaultConnected: boolean;
}

/** The cluster surface secretops needs — K8sClient satisfies it structurally. */
export interface SecretOpsCluster {
  getTelemetry(): Promise<ClusterTelemetry>;
  getSecrets(): Promise<SecretInfo[]>;
  getSecret(name: string, namespace: string): Promise<SecretDetail | null>;
  getConfigMaps(): Promise<ConfigMapInfo[]>;
  getPodSpecs(): Promise<PodSpecInfo[]>;
  getExternalSecretsStatus(): Promise<ExternalSecretsStatus>;
}

export interface SecretOpsDeps {
  cluster?: SecretOpsCluster;
  run?: (command: string, args: string[], options: RunCommandOptions) => Promise<CommandWaitResult>;
  /** Returns a fresh random credential value (default: 32 alphanumeric chars). */
  generateSecret?: () => string;
  now?: () => number;
}

export interface RotateSecretResult {
  success: boolean;
  /** The secret's real resourceVersion after the patch (empty when not rotated). */
  newVersion: string;
  message: string;
  /** Why a failed rotation failed: unknown secret, or a secret that cannot be rotated in place. */
  reason?: 'not_found' | 'not_rotatable';
}

/**
 * Annotation rotation writes into the applied manifest, so the audit
 * can report a real last-rotation time (and reset the age) instead of
 * falling back to creationTimestamp forever. Secrets rotated outside
 * this tool have no annotation and fall back to creationTimestamp.
 */
const LAST_ROTATED_ANNOTATION = 'secretops.vow.io/last-rotated';

// Hygiene policy: 90-day maximum age (the page's stated policy).
const STALE_AGE_DAYS = 90;
const WARNING_AGE_DAYS = 60;

async function requireCluster(cluster: SecretOpsCluster): Promise<void> {
  const telemetry = await cluster.getTelemetry();
  if (!telemetry.isConnected) {
    throw new ClusterUnavailableError();
  }
}

function defaultCluster(): SecretOpsCluster {
  return new K8sClient();
}

function defaultRun(
  command: string,
  args: string[],
  options: RunCommandOptions
): Promise<CommandWaitResult> {
  return processManager.runCommandAndWait(command, args, options);
}

// --- Leak detection -------------------------------------------------------

const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/;
const GITHUB_TOKEN_RE = /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}/;
const PRIVATE_KEY_RE = /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;
const PASSWORD_KEY_RE = /passw(or)?d|passwd|pwd/i;
const ROTATABLE_KEY_RE = /password|passwd|pwd|token|secret|key|credential/i;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Mask a credential for display: first 4 + last 4 chars, nothing else. */
function maskValue(value: string): string {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

type DetectedKind = SecretLeakFinding['detectedType'];
type DetectedSeverity = SecretLeakFinding['severity'];

function classifyValue(
  key: string,
  value: string
): { detectedType: DetectedKind; severity: DetectedSeverity } | null {
  if (AWS_KEY_RE.test(value)) return { detectedType: 'AWS_KEY', severity: 'CRITICAL' };
  if (GITHUB_TOKEN_RE.test(value)) return { detectedType: 'GITHUB_TOKEN', severity: 'CRITICAL' };
  if (PRIVATE_KEY_RE.test(value)) return { detectedType: 'PRIVATE_KEY', severity: 'CRITICAL' };
  if (PASSWORD_KEY_RE.test(key) && value.length >= 4) {
    return { detectedType: 'DATABASE_PASSWORD', severity: 'HIGH' };
  }
  if (value.length >= 20 && !/\s/.test(value) && shannonEntropy(value) > 4.5) {
    return { detectedType: 'GENERIC_HIGH_ENTROPY', severity: 'MEDIUM' };
  }
  return null;
}

function recommendationFor(targetType: SecretLeakFinding['targetType']): string {
  switch (targetType) {
    case 'POD_ENV':
      return 'Replace the literal value with a secretKeyRef to a Secret, or an ExternalSecret.';
    case 'CONFIGMAP':
      return 'ConfigMaps are unencrypted in etcd. Move credentials to Secret or Vault.';
    case 'CONTAINER_ARG':
      return 'Command line arguments are visible via ps and /proc in container host.';
    case 'LOG_STDOUT':
      return 'Credential material in logs must be redacted at the source.';
  }
}

/**
 * Scan pod env/args and ConfigMap data for leaked credentials.
 * Literal values are examined in memory only; findings carry masked
 * values. Values sourced from a Secret/ConfigMap reference
 * (secretKeyRef, configMapKeyRef, envFrom, volumes) are the good
 * pattern and are never flagged. LOG_STDOUT findings are not produced
 * — log scanning is not implemented and is not fabricated.
 */
function scanLeaks(pods: PodSpecInfo[], configMaps: ConfigMapInfo[]): SecretLeakFinding[] {
  const leaks: SecretLeakFinding[] = [];
  const sortedPods = [...pods].sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
  );
  const push = (
    workloadName: string,
    namespace: string,
    targetType: SecretLeakFinding['targetType'],
    key: string,
    value: string,
    detected: { detectedType: DetectedKind; severity: DetectedSeverity }
  ): void => {
    leaks.push({
      id: `leak-${String(leaks.length + 1).padStart(2, '0')}`,
      workloadName,
      namespace,
      targetType,
      key,
      maskedValue: maskValue(value),
      detectedType: detected.detectedType,
      severity: detected.severity,
      recommendation: recommendationFor(targetType),
    });
  };

  for (const pod of sortedPods) {
    for (const container of pod.containers) {
      for (const env of container.env) {
        // Referenced values are the safe pattern — only literals are scanned.
        if (env.value === undefined) continue;
        const detected = classifyValue(env.name, env.value);
        if (detected) push(pod.name, pod.namespace, 'POD_ENV', env.name, env.value, detected);
      }
      for (const arg of container.args) {
        const detected = classifyValue(arg, arg);
        if (!detected) continue;
        const key = arg.includes('=') ? arg.split('=')[0] : arg.slice(0, 24);
        push(pod.name, pod.namespace, 'CONTAINER_ARG', key, arg, detected);
      }
    }
  }

  const sortedMaps = [...configMaps].sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
  );
  for (const cm of sortedMaps) {
    for (const key of Object.keys(cm.data).sort()) {
      const detected = classifyValue(key, cm.data[key]);
      if (detected) push(cm.name, cm.namespace, 'CONFIGMAP', key, cm.data[key], detected);
    }
  }
  return leaks;
}

// --- Hygiene --------------------------------------------------------------

function managedByFor(secret: SecretInfo): SecretHygieneRecord['managedBy'] {
  const labels = secret.labels ?? {};
  const annotations = secret.annotations ?? {};
  if (
    secret.ownerKinds.includes('ExternalSecret') ||
    labels['app.kubernetes.io/managed-by'] === 'external-secrets' ||
    Object.keys(annotations).some((k) => k.startsWith('external-secrets.io/')) ||
    Object.keys(labels).some((k) => k.startsWith('external-secrets.io/'))
  ) {
    return 'ESO / Vault';
  }
  if (labels['cert-manager.io/certificate-name'] || annotations['cert-manager.io/certificate-name']) {
    return 'cert-manager';
  }
  if (labels['app.kubernetes.io/managed-by'] === 'argocd' || annotations['argocd.argoproj.io/tracking-id']) {
    return 'ArgoCD';
  }
  return 'Manual';
}

function hygieneFor(secret: SecretInfo, nowMs: number): SecretHygieneRecord {
  // The API exposes no rotation history: last rotation is the
  // annotation this tool writes on rotation, falling back to creation.
  const annotated = secret.annotations?.[LAST_ROTATED_ANNOTATION];
  const annotatedMs = annotated ? Date.parse(annotated) : NaN;
  const createdMs = secret.creationTimestamp ? Date.parse(secret.creationTimestamp) : NaN;
  const lastRotatedMs = Number.isFinite(annotatedMs) ? annotatedMs : createdMs;
  const ageDays = Number.isFinite(lastRotatedMs)
    ? Math.max(0, Math.floor((nowMs - lastRotatedMs) / 86400000))
    : 0;
  const lastRotated = Number.isFinite(lastRotatedMs) ? new Date(lastRotatedMs).toISOString() : '';
  const status =
    ageDays > STALE_AGE_DAYS
      ? 'EXPIRED_ROTATION_NEEDED'
      : ageDays > WARNING_AGE_DAYS
        ? 'WARNING'
        : 'HEALTHY';
  return {
    secretName: secret.name,
    namespace: secret.namespace,
    type: secret.type,
    ageDays,
    lastRotated,
    status,
    managedBy: managedByFor(secret),
  };
}

// --- Audit ----------------------------------------------------------------

export async function auditSecretsAndLeaks(deps: SecretOpsDeps = {}): Promise<SecretOpsReport> {
  const cluster = deps.cluster ?? defaultCluster();
  const now = deps.now ?? Date.now;
  await requireCluster(cluster);
  const [secrets, configMaps, pods, eso] = await Promise.all([
    cluster.getSecrets(),
    cluster.getConfigMaps(),
    cluster.getPodSpecs(),
    cluster.getExternalSecretsStatus(),
  ]);
  const leaks = scanLeaks(pods, configMaps);
  const hygieneRecords = secrets.map((s) => hygieneFor(s, now()));
  const staleSecretCount = hygieneRecords.filter((h) => h.status === 'EXPIRED_ROTATION_NEEDED').length;
  return {
    totalSecrets: secrets.length,
    leaksDetected: leaks,
    hygieneRecords,
    staleSecretCount,
    externalVaultConnected: eso.storeReady || eso.readyExternalSecretCount > 0,
  };
}

// --- Rotation -------------------------------------------------------------

/**
 * Only Opaque secrets are rotated by replacing a data key. Structured
 * types have values rotation would corrupt (a TLS secret's key would no
 * longer match its certificate; a dockerconfigjson is a JSON document,
 * not a credential) — those are refused, not guessed at.
 */
const ROTATABLE_SECRET_TYPES = new Set(['Opaque', '']);

function pickRotatableKey(dataKeys: string[]): string | null {
  return dataKeys.find((k) => ROTATABLE_KEY_RE.test(k)) ?? dataKeys[0] ?? null;
}

function referencesSecret(pod: PodSpecInfo, secretName: string): boolean {
  for (const c of pod.containers) {
    if (c.env.some((e) => e.valueFromKind === 'secretKeyRef' && e.valueFromName === secretName)) {
      return true;
    }
    if (c.envFromSecrets.includes(secretName)) return true;
  }
  return pod.volumes.some((v) => v.secretName === secretName);
}

interface RestartTarget {
  kind: string;
  name: string;
  namespace: string;
}

/**
 * Resolve a ReplicaSet-owned pod to its Deployment via the RS's owner.
 * Pods are owned by ReplicaSets, not Deployments, so the common case
 * needs this hop. Returns null when the RS has no Deployment owner
 * (or is gone) — the caller reports it as a manual step.
 */
async function resolveReplicaSetDeployment(
  rsName: string,
  namespace: string,
  run: NonNullable<SecretOpsDeps['run']>
): Promise<string | null> {
  const res = await run('kubectl', ['get', 'replicaset', rsName, '-n', namespace, '-o', 'json'], {
    cwd: process.cwd(),
  });
  if (res.code !== 0) return null;
  try {
    const obj = JSON.parse(res.stdout) as {
      metadata?: { ownerReferences?: { kind?: string; name?: string }[] };
    };
    const owner = (obj.metadata?.ownerReferences || []).find((o) => o.kind === 'Deployment');
    return owner?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the apply manifest for a rotated secret: the full live data map
 * with the rotated key replaced, plus the live labels/annotations (and
 * the rotation timestamp). A partial manifest would be unsafe across
 * repeated applies — kubectl apply deletes fields present in the
 * previous last-applied manifest but absent from the new one — so the
 * whole data map is always submitted.
 */
function buildSecretManifest(secret: SecretDetail, key: string, newBase64: string, nowMs: number): string {
  const annotations = { ...(secret.annotations ?? {}) };
  delete annotations['kubectl.kubernetes.io/last-applied-configuration'];
  annotations[LAST_ROTATED_ANNOTATION] = new Date(nowMs).toISOString();
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: secret.name,
      namespace: secret.namespace,
      labels: { ...(secret.labels ?? {}) },
      annotations,
    },
    type: secret.type || 'Opaque',
    data: { ...(secret.data ?? {}), [key]: newBase64 },
  });
}

export async function rotateSecretCredential(
  secretName: string,
  namespace: string,
  deps: SecretOpsDeps = {}
): Promise<RotateSecretResult> {
  const cluster = deps.cluster ?? defaultCluster();
  const run = deps.run ?? defaultRun;
  const generateSecret = deps.generateSecret ?? (() => generateRandomSecret(32));
  const now = deps.now ?? Date.now;
  await requireCluster(cluster);

  const secret = await cluster.getSecret(secretName, namespace);
  if (!secret) {
    return {
      success: false,
      newVersion: '',
      message: `Secret ${secretName} not found in namespace ${namespace}.`,
      reason: 'not_found',
    };
  }
  if (secret.immutable) {
    return {
      success: false,
      newVersion: '',
      message: `Secret ${secretName} is immutable and cannot be rotated in place.`,
      reason: 'not_rotatable',
    };
  }
  if (!ROTATABLE_SECRET_TYPES.has(secret.type)) {
    return {
      success: false,
      newVersion: '',
      message:
        `Secret ${secretName} is of type ${secret.type}, whose values are structured — ` +
        'rotating a single key would corrupt it. Reissue it through its own controller instead.',
      reason: 'not_rotatable',
    };
  }
  const key = pickRotatableKey(secret.dataKeys);
  if (!key) {
    return {
      success: false,
      newVersion: '',
      message: `Secret ${secretName} has no data keys to rotate.`,
      reason: 'not_rotatable',
    };
  }

  const newValue = generateSecret();
  const newBase64 = Buffer.from(newValue, 'utf-8').toString('base64');
  // The new value travels only via stdin (the apply manifest) — never
  // in argv, so it cannot reach the persisted task record.
  const applyResult = await run('kubectl', ['apply', '-f', '-'], {
    cwd: process.cwd(),
    input: buildSecretManifest(secret, key, newBase64, now()),
  });
  assertCommandSuccess(applyResult, `kubectl apply secret ${namespace}/${secretName}`);

  // Re-read: confirm the value landed and capture the real resourceVersion.
  const after = await cluster.getSecret(secretName, namespace);
  if (!after) {
    throw new Error(`Secret ${secretName} disappeared after rotation.`);
  }
  if ((after.data?.[key] ?? '') !== newBase64) {
    throw new Error(`Secret ${secretName} was not updated by the rotation.`);
  }
  if (!after.resourceVersion) {
    throw new Error('Rotation succeeded but the secret has no resourceVersion to report.');
  }

  // Find the workloads that consume this secret and restart them.
  const pods = await cluster.getPodSpecs();
  const restartTargets: RestartTarget[] = [];
  const manual: string[] = [];
  const seen = new Set<string>();
  const pushTarget = (kind: string, name: string, ns: string): void => {
    const id = `${kind}/${ns}/${name}`;
    if (seen.has(id)) return;
    seen.add(id);
    restartTargets.push({ kind, name, namespace: ns });
  };
  for (const pod of pods) {
    if (!referencesSecret(pod, secretName)) continue;
    const ownerKind = pod.ownerKind;
    const ownerName = pod.ownerName;
    if (!ownerKind || !ownerName) {
      manual.push(`pod ${pod.namespace}/${pod.name} (no controller; recreate it manually)`);
      continue;
    }
    if (ownerKind === 'Deployment' || ownerKind === 'StatefulSet' || ownerKind === 'DaemonSet') {
      pushTarget(ownerKind.toLowerCase(), ownerName, pod.namespace);
    } else if (ownerKind === 'ReplicaSet') {
      const deployment = await resolveReplicaSetDeployment(ownerName, pod.namespace, run);
      if (deployment) {
        pushTarget('deployment', deployment, pod.namespace);
      } else {
        manual.push(
          `replicaset ${pod.namespace}/${ownerName} (no Deployment owner found; restart its workloads manually)`
        );
      }
    } else {
      manual.push(
        `${ownerKind.toLowerCase()} ${pod.namespace}/${ownerName} (no rollout restart for this kind; ` +
          'recreate it to pick up the new value)'
      );
    }
  }

  for (const target of restartTargets) {
    const restart = await run(
      'kubectl',
      ['rollout', 'restart', `${target.kind}/${target.name}`, '-n', target.namespace],
      { cwd: process.cwd() }
    );
    assertCommandSuccess(restart, `kubectl rollout restart ${target.kind}/${target.name}`);
    const status = await run(
      'kubectl',
      ['rollout', 'status', `${target.kind}/${target.name}`, '-n', target.namespace, '--timeout=120s'],
      { cwd: process.cwd() }
    );
    assertCommandSuccess(status, `kubectl rollout status ${target.kind}/${target.name}`);
  }

  const restarted = restartTargets.map((t) => `${t.kind}/${t.name}`).join(', ');
  let message = `Rotated key '${key}' for secret ${secretName} in namespace ${namespace}.`;
  if (restarted) {
    message += ` Restarted and verified: ${restarted}.`;
  } else {
    message += ' No dependent workloads reference this secret.';
  }
  if (manual.length > 0) {
    message += ` Not restarted: ${manual.join('; ')}.`;
  }
  if (managedByFor(secret) === 'ArgoCD') {
    message +=
      ' Warning: this secret is managed by ArgoCD — the next sync may revert the rotation unless the GitOps source is updated.';
  }
  return { success: true, newVersion: after.resourceVersion, message };
}

/**
 * SealedSecret generation is NOT implemented.
 *
 * The previous implementation emitted a manifest whose "encryptedData"
 * values were a fixed sample prefix plus the first bytes of the caller's
 * plaintext, base64-encoded — not encryption at all, and labeled as safe
 * to commit to public repositories. Emitting anything labeled "sealed"
 * without real sealed-secrets encryption (kubeseal-style, with the
 * cluster's public cert) is a credential-leak vector, so this function
 * refuses instead of fabricating output. It deliberately ignores its
 * arguments (including any plaintext) so no caller input can reach an
 * error message or a manifest.
 */
export function generateSealedSecretManifest(
  _secretName: string,
  _namespace: string,
  _keyValues: Record<string, string>
): string {
  throw new Error(
    'SealedSecret encryption is not implemented: refusing to emit a fake sealed manifest. ' +
      'Generate sealed values with kubeseal against the cluster sealed-secrets public key instead.'
  );
}
