import { parseYaml, stringifyYaml } from './yaml.js';
import { K8sClient } from './k8s.js';
import {
  processManager,
  assertCommandSuccess,
  type CommandWaitResult,
} from './executor.js';
import { requireFound } from './studio-store.js';
import { ClusterUnavailableError } from './errors.js';

export interface AdmissionPolicyRule {
  id: string;
  name: string;
  category: 'SECURITY' | 'RELIABILITY' | 'BEST_PRACTICES';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  ruleType: 'VALIDATING' | 'MUTATING';
  enabled: boolean;
}

export interface EvaluationFinding {
  ruleId: string;
  ruleName: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  passed: boolean;
  message: string;
  path?: string;
}

export interface EvaluationResult {
  totalRules: number;
  passedRules: number;
  failedRules: number;
  score: number;
  compliant: boolean;
  findings: EvaluationFinding[];
  mutatedYaml?: string;
}

/**
 * Thrown when a manifest cannot be parsed as YAML or is not a YAML
 * mapping. The guard route maps it to 400 (never echo the raw input).
 */
export class InvalidManifestError extends Error {
  constructor(message = 'Invalid YAML: could not parse manifest') {
    super(message);
    this.name = 'InvalidManifestError';
  }
}

/**
 * Toggle persistence (studio wiring, Phase 1): the rule set lives in a
 * ConfigMap in the cluster, not only in this process's memory. The
 * ConfigMap is the source of truth; the module-level `policyRules` is a
 * working copy synced from it. Namespace `default`: there is no
 * guard-specific namespace configured anywhere in the repo, and the
 * policies are cluster-scoped admission rules, not per-app config.
 */
export const GUARD_POLICIES_CONFIGMAP = 'vow-guard-policies';
export const GUARD_POLICIES_NAMESPACE = 'default';
const GUARD_POLICIES_DATA_KEY = 'rules.json';

/**
 * Injectable seams for the cluster-backed operations (Batch C wiring).
 * The defaults hit the real cluster; tests pass fakes. Mirrors the
 * `deps` pattern in ebpf.ts.
 */
export interface GuardDeps {
  /** Reachability probe — defaults to the cached `getTelemetry()` check. */
  probeCluster?: () => Promise<boolean>;
  /** kubectl invocation — defaults to `processManager.runCommandAndWait`. */
  runKubectl?: (args: string[], input?: string) => Promise<CommandWaitResult>;
}

async function defaultProbeCluster(): Promise<boolean> {
  // Constructing the client applies the k3s.yaml KUBECONFIG fallback
  // (k8s.ts), which the kubectl calls below then inherit — probe first,
  // then kubectl, in that order.
  return (await new K8sClient().getTelemetry()).isConnected;
}

async function defaultRunKubectl(args: string[], input?: string): Promise<CommandWaitResult> {
  return processManager.runCommandAndWait('kubectl', args, {
    cwd: process.cwd(),
    ...(input !== undefined ? { input } : {}),
  });
}

/**
 * The built-in rule set. `policyRules` below is a mutable working copy
 * synced from the ConfigMap; this array is never mutated, so a stored
 * rule set can always be merged back onto the true defaults (a rule
 * deleted from the ConfigMap reverts to its default, it does not keep
 * a stale synced value).
 */
const DEFAULT_POLICY_RULES: AdmissionPolicyRule[] = [
  {
    id: 'disallow-privileged-containers',
    name: 'Disallow Privileged Containers',
    category: 'SECURITY',
    severity: 'HIGH',
    description: 'Privileged containers share root capabilities with the host node and must be forbidden.',
    ruleType: 'VALIDATING',
    enabled: true,
  },
  {
    id: 'require-read-only-rootfs',
    name: 'Require Read-Only Root Filesystem',
    category: 'SECURITY',
    severity: 'MEDIUM',
    description: 'Enforces securityContext.readOnlyRootFilesystem: true to prevent container tampering.',
    ruleType: 'VALIDATING',
    enabled: true,
  },
  {
    id: 'disallow-latest-image-tag',
    name: 'Disallow :latest Image Tags',
    category: 'BEST_PRACTICES',
    severity: 'MEDIUM',
    description: 'Containers must use explicit immutable semantic version tags rather than mutable :latest.',
    ruleType: 'VALIDATING',
    enabled: true,
  },
  {
    id: 'require-resource-limits',
    name: 'Require CPU & Memory Resource Limits',
    category: 'RELIABILITY',
    severity: 'HIGH',
    description: 'Containers must specify limits.cpu and limits.memory to protect noisy-neighbor workloads.',
    ruleType: 'VALIDATING',
    enabled: true,
  },
  {
    id: 'require-non-root-user',
    name: 'Enforce Non-Root UID Execution',
    category: 'SECURITY',
    severity: 'HIGH',
    description: 'Workloads must set securityContext.runAsNonRoot: true and define an explicit runAsUser > 0.',
    ruleType: 'VALIDATING',
    enabled: true,
  },
  {
    id: 'disallow-host-network-ipc',
    name: 'Disallow Host Network & IPC Sharing',
    category: 'SECURITY',
    severity: 'HIGH',
    description: 'Containers must not share hostNetwork or hostIPC namespaces with the node.',
    ruleType: 'VALIDATING',
    enabled: true,
  },
  {
    id: 'auto-mutate-standard-labels',
    name: 'Auto-Mutate Recommended Kubernetes Labels',
    category: 'BEST_PRACTICES',
    severity: 'LOW',
    description: 'Mutating webhook automatically injects app.kubernetes.io/managed-by: vigilant-octo-waffle.',
    ruleType: 'MUTATING',
    enabled: true,
  },
];

/** Working copy of the rule set, synced from the ConfigMap (see above). */
const policyRules: AdmissionPolicyRule[] = DEFAULT_POLICY_RULES.map((r) => ({ ...r }));

type PoliciesReadResult =
  | { status: 'ok'; rules: AdmissionPolicyRule[] }
  | { status: 'not-found' };

/**
 * Merge a stored rule set onto the built-in defaults. Only the `enabled`
 * flag is persisted — the rest of each rule is content defined here.
 * Stored entries for unknown ids are ignored (only rules this dashboard
 * knows are ever evaluated); known rules missing from the store keep
 * their default. Malformed entries fail loudly: a hand-edited ConfigMap
 * must not silently evaluate with the wrong rule set.
 */
function mergeStoredRules(stored: unknown): AdmissionPolicyRule[] {
  if (!Array.isArray(stored)) {
    throw new Error('Guard policy ConfigMap is malformed: rules.json is not an array');
  }
  const enabledById = new Map<string, boolean>();
  for (const entry of stored) {
    const rec = asRecord(entry);
    if (!rec || typeof rec.id !== 'string' || typeof rec.enabled !== 'boolean') {
      throw new Error(
        'Guard policy ConfigMap is malformed: each rule needs a string id and boolean enabled'
      );
    }
    enabledById.set(rec.id, rec.enabled);
  }
  return DEFAULT_POLICY_RULES.map((r) =>
    enabledById.has(r.id) ? { ...r, enabled: enabledById.get(r.id) as boolean } : { ...r }
  );
}

/**
 * Read the persisted rule set from the cluster. `not-found` covers both
 * a missing ConfigMap and a ConfigMap with no `rules.json` key — no
 * persisted state yet, so the in-memory defaults stand. Any other
 * non-zero exit (API down, RBAC, missing binary) is a real failure,
 * never silently treated as absent: kubectl reports a missing object
 * as a NotFound error on stderr, and only that is a not-found.
 */
async function readPoliciesFromCluster(deps: GuardDeps): Promise<PoliciesReadResult> {
  const runKubectl = deps.runKubectl ?? defaultRunKubectl;
  const result = await runKubectl([
    'get',
    'configmap',
    GUARD_POLICIES_CONFIGMAP,
    '-n',
    GUARD_POLICIES_NAMESPACE,
    '-o',
    'json',
  ]);
  if (result.code !== 0) {
    if (result.stderr.includes('NotFound')) return { status: 'not-found' };
    throw new Error('Failed to read guard policies ConfigMap');
  }
  let doc: unknown;
  try {
    doc = JSON.parse(result.stdout);
  } catch {
    throw new Error('Guard policy ConfigMap is malformed: not valid JSON');
  }
  const raw = asRecord(asRecord(doc)?.data)?.[GUARD_POLICIES_DATA_KEY];
  if (raw === undefined) return { status: 'not-found' };
  if (typeof raw !== 'string') {
    throw new Error('Guard policy ConfigMap is malformed: rules.json is not a string');
  }
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    throw new Error('Guard policy ConfigMap is malformed: rules.json is not valid JSON');
  }
  return { status: 'ok', rules: mergeStoredRules(stored) };
}

/**
 * Replace the working copy with the persisted rule set (no-op when
 * absent). Probes first: with no cluster there is nothing to sync, and
 * skipping the kubectl call keeps the best-effort evaluation sync cheap
 * offline. Callers that must distinguish "no cluster" from "no stored
 * state" (list, toggle) probe themselves and throw first.
 */
async function syncPoliciesFromCluster(deps: GuardDeps): Promise<void> {
  const probeCluster = deps.probeCluster ?? defaultProbeCluster;
  if (!(await probeCluster())) return;
  const read = await readPoliciesFromCluster(deps);
  if (read.status === 'ok') {
    policyRules.splice(0, policyRules.length, ...read.rules);
  }
}

/** Build the ConfigMap manifest holding a rule set, as YAML (C6: objects, never interpolation). */
function buildPoliciesConfigMapManifest(rules: AdmissionPolicyRule[]): string {
  return stringifyYaml({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: GUARD_POLICIES_CONFIGMAP,
      namespace: GUARD_POLICIES_NAMESPACE,
      labels: { 'app.kubernetes.io/managed-by': 'vigilant-octo-waffle' },
    },
    data: { [GUARD_POLICIES_DATA_KEY]: JSON.stringify(rules) },
  });
}

/**
 * List the admission policies, synced from the cluster. The persisted
 * state is unreadable with no cluster, so this errors (503
 * `cluster_unavailable` at the route) instead of returning the
 * in-memory defaults — the `enabled` flags in those defaults may not
 * match what an operator persisted.
 */
export async function listAdmissionPolicies(deps: GuardDeps = {}): Promise<AdmissionPolicyRule[]> {
  const probeCluster = deps.probeCluster ?? defaultProbeCluster;
  if (!(await probeCluster())) {
    throw new ClusterUnavailableError();
  }
  await syncPoliciesFromCluster(deps);
  return policyRules.map((r) => ({ ...r }));
}

/**
 * Toggle a rule and persist the change to the ConfigMap. The cluster is
 * probed first: with no cluster the toggle errors (503
 * `cluster_unavailable` at the route), never silently succeeds
 * in-memory. The persisted state is read before writing, so a toggle
 * never clobbers a rule changed by another replica or an operator, and
 * the write is verified by reading the ConfigMap back — if the toggle
 * did not land, this throws instead of reporting success. Unknown ids
 * return null (the route maps that to 404); nothing is written.
 */
export async function togglePolicyRule(
  ruleId: string,
  enabled: boolean,
  deps: GuardDeps = {}
): Promise<AdmissionPolicyRule | null> {
  const probeCluster = deps.probeCluster ?? defaultProbeCluster;
  if (!(await probeCluster())) {
    throw new ClusterUnavailableError();
  }
  await syncPoliciesFromCluster(deps);
  const rule = requireFound(policyRules, (r) => r.id === ruleId);
  if (!rule) return null;
  const updated = policyRules.map((r) => (r.id === ruleId ? { ...r, enabled } : { ...r }));
  const manifest = buildPoliciesConfigMapManifest(updated);
  const applied = await (deps.runKubectl ?? defaultRunKubectl)(['apply', '-f', '-'], manifest);
  assertCommandSuccess(applied, 'kubectl apply -f - (guard policies ConfigMap)');
  const readBack = await readPoliciesFromCluster(deps);
  if (readBack.status !== 'ok') {
    throw new Error('Guard policy ConfigMap could not be read back after apply');
  }
  policyRules.splice(0, policyRules.length, ...readBack.rules);
  const verified = requireFound(policyRules, (r) => r.id === ruleId);
  if (!verified || verified.enabled !== enabled) {
    throw new Error('Guard policy toggle was not persisted');
  }
  return { ...verified };
}

/**
 * Live admission-webhook presence, for the guard page banner. Lists the
 * cluster's ValidatingWebhookConfiguration and MutatingWebhookConfiguration
 * objects — no such object exists in a cluster without an admission
 * controller installed, and the page must not claim enforcement that
 * isn't there. A failed listing degrades to `error` (the page renders
 * Unknown) rather than masquerading as "no webhook installed", while
 * the policies list still loads.
 */
export interface AdmissionWebhookStatus {
  installed: boolean;
  validating: string[];
  mutating: string[];
  error?: string;
}

async function listWebhookConfigurationNames(
  runKubectl: NonNullable<GuardDeps['runKubectl']>,
  kind: 'validatingwebhookconfiguration' | 'mutatingwebhookconfiguration'
): Promise<string[]> {
  const result = await runKubectl(['get', kind, '-o', 'json']);
  if (result.code !== 0) {
    throw new Error(`Failed to list ${kind}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Failed to list ${kind}: not valid JSON`);
  }
  const items = asRecord(doc)?.items;
  if (!Array.isArray(items)) return [];
  const names = items
    .map((item) => asRecord(asRecord(item)?.metadata)?.name)
    .filter((name): name is string => typeof name === 'string');
  return [...names].sort();
}

export async function getAdmissionWebhookStatus(
  deps: GuardDeps = {}
): Promise<AdmissionWebhookStatus> {
  const probeCluster = deps.probeCluster ?? defaultProbeCluster;
  if (!(await probeCluster())) {
    throw new ClusterUnavailableError();
  }
  const runKubectl = deps.runKubectl ?? defaultRunKubectl;
  try {
    const [validating, mutating] = await Promise.all([
      listWebhookConfigurationNames(runKubectl, 'validatingwebhookconfiguration'),
      listWebhookConfigurationNames(runKubectl, 'mutatingwebhookconfiguration'),
    ]);
    return { installed: validating.length + mutating.length > 0, validating, mutating };
  } catch {
    return {
      installed: false,
      validating: [],
      mutating: [],
      error: 'Could not list admission webhooks',
    };
  }
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** Extract the pod spec from a workload manifest, following the owner reference for each kind. */
function extractPodSpec(doc: UnknownRecord): UnknownRecord | null {
  const spec = asRecord(doc.spec);
  if (!spec) return null;
  if (doc.kind === 'Pod') return spec;
  if (doc.kind === 'CronJob') {
    // CronJob -> spec.jobTemplate.spec.template.spec
    const jobTemplate = asRecord(spec.jobTemplate);
    const jobSpec = jobTemplate ? asRecord(jobTemplate.spec) : null;
    const template = jobSpec ? asRecord(jobSpec.template) : null;
    return template ? asRecord(template.spec) : null;
  }
  // Deployment, StatefulSet, DaemonSet, ReplicaSet, Job -> spec.template.spec
  const template = asRecord(spec.template);
  return template ? asRecord(template.spec) : null;
}

function podContainers(podSpec: UnknownRecord | null): UnknownRecord[] {
  if (!podSpec) return [];
  const containers = podSpec.containers;
  if (!Array.isArray(containers)) return [];
  return containers
    .map((c) => asRecord(c))
    .filter((c): c is UnknownRecord => c !== null);
}

/**
 * An image reference is pinned when it carries a digest (`image@sha256:...`,
 * immutable regardless of any tag) or a tag other than `latest`. Untagged
 * references fail. No strict semver grammar is enforced: legitimate tags
 * such as `27.1-apache` are not semver but are pinned.
 */
function imageIsPinned(image: unknown): boolean {
  if (typeof image !== 'string' || image.length === 0) return false;
  const atIdx = image.indexOf('@');
  if (atIdx !== -1) return image.slice(atIdx + 1).length > 0;
  const lastSlash = image.lastIndexOf('/');
  const lastSegment = image.slice(lastSlash + 1);
  const colon = lastSegment.indexOf(':');
  if (colon === -1) return false;
  return lastSegment.slice(colon + 1) !== 'latest';
}

/**
 * Evaluate a manifest against the enabled VALIDATING policy rules, reading
 * real parsed fields (Batch C, C3) — never substring matches over raw text,
 * so a comment mentioning `privileged: true` cannot reject a manifest.
 *
 * Each rule produces at most one finding, aggregated across containers.
 * Compliance requires no HIGH failure AND a score >= 80 (the old 80% bar
 * is kept for non-HIGH failures; any HIGH failure is now blocking).
 * The mutated YAML is always produced from the parsed object, regardless
 * of which rules are enabled.
 */
export async function evaluateManifest(
  yamlContent: string,
  deps: GuardDeps = {}
): Promise<EvaluationResult> {
  // Best-effort sync: evaluation is a pure-compute sandbox that works
  // offline, so a failed sync (no cluster, no ConfigMap yet) keeps the
  // in-memory rules and never throws. When the cluster is reachable,
  // the persisted enabled flags apply — a rule disabled in the cluster
  // must not reject a manifest evaluated here.
  await syncPoliciesFromCluster(deps).catch(() => undefined);

  let doc: unknown;
  try {
    doc = parseYaml(yamlContent);
  } catch {
    throw new InvalidManifestError();
  }
  const manifest = asRecord(doc);
  if (!manifest) {
    throw new InvalidManifestError('Invalid YAML: manifest must be a mapping');
  }

  const podSpec = extractPodSpec(manifest);
  const containers = podContainers(podSpec);
  const podSecurityContext = asRecord(podSpec?.securityContext) ?? {};

  const findings: EvaluationFinding[] = [];
  const enabledRules = policyRules.filter((r) => r.enabled && r.ruleType === 'VALIDATING');

  for (const rule of enabledRules) {
    switch (rule.id) {
      case 'disallow-privileged-containers': {
        const offenders = containers.filter(
          (c) => asRecord(c.securityContext)?.privileged === true
        );
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          passed: offenders.length === 0,
          message:
            offenders.length > 0
              ? `REJECTED: ${offenders.length} container(s) explicitly request privileged: true mode.`
              : 'PASSED: No privileged container flags detected.',
          path: 'spec.template.spec.containers[*].securityContext.privileged',
        });
        break;
      }

      case 'require-read-only-rootfs': {
        const offenders = containers.filter(
          (c) => asRecord(c.securityContext)?.readOnlyRootFilesystem !== true
        );
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          passed: offenders.length === 0,
          message:
            offenders.length > 0
              ? `WARNING: ${offenders.length} container(s) missing securityContext.readOnlyRootFilesystem: true.`
              : 'PASSED: Container root filesystem is mounted as read-only.',
          path: 'spec.template.spec.containers[*].securityContext.readOnlyRootFilesystem',
        });
        break;
      }

      case 'disallow-latest-image-tag': {
        const offenders = containers.filter((c) => !imageIsPinned(c.image));
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          passed: offenders.length === 0,
          message:
            offenders.length > 0
              ? 'REJECTED: Image uses mutable :latest or untagged reference.'
              : 'PASSED: Image uses pinned semantic version tag.',
          path: 'spec.template.spec.containers[*].image',
        });
        break;
      }

      case 'require-resource-limits': {
        const offenders = containers.filter((c) => {
          const limits = asRecord(asRecord(c.resources)?.limits);
          return !limits || !hasValue(limits.cpu) || !hasValue(limits.memory);
        });
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          passed: offenders.length === 0,
          message:
            offenders.length > 0
              ? `REJECTED: ${offenders.length} container(s) lack limits.cpu and limits.memory, risking node OOM.`
              : 'PASSED: Explicit CPU and memory resource limits defined.',
          path: 'spec.template.spec.containers[*].resources.limits',
        });
        break;
      }

      case 'require-non-root-user': {
        // Effective values inherit pod-level -> container-level.
        const offenders = containers.filter((c) => {
          const sc = asRecord(c.securityContext) ?? {};
          const runAsNonRoot = sc.runAsNonRoot ?? podSecurityContext.runAsNonRoot;
          const runAsUser = sc.runAsUser ?? podSecurityContext.runAsUser;
          return !(runAsNonRoot === true && typeof runAsUser === 'number' && runAsUser > 0);
        });
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          passed: offenders.length === 0,
          message:
            offenders.length > 0
              ? `WARNING: ${offenders.length} container(s) missing securityContext.runAsNonRoot: true with runAsUser > 0.`
              : 'PASSED: Workload is configured to run as non-root UID.',
          path: 'spec.template.spec.securityContext.runAsNonRoot',
        });
        break;
      }

      case 'disallow-host-network-ipc': {
        const sharesHost = podSpec?.hostNetwork === true || podSpec?.hostIPC === true;
        findings.push({
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          passed: !sharesHost,
          message: sharesHost
            ? 'REJECTED: Workload shares hostNetwork or hostIPC namespaces with underlying node.'
            : 'PASSED: Workload network and IPC namespaces are properly isolated.',
          path: 'spec.template.spec.hostNetwork',
        });
        break;
      }

      default:
        break;
    }
  }

  // Mutate real fields on the parsed manifest, then serialize: inject the
  // standard managed-by label and set readOnlyRootFilesystem on every
  // container that lacks it.
  const metadata = asRecord(manifest.metadata) ?? {};
  manifest.metadata = metadata;
  const labels = asRecord(metadata.labels) ?? {};
  metadata.labels = labels;
  labels['app.kubernetes.io/managed-by'] = 'vigilant-octo-waffle';
  for (const container of containers) {
    const sc = asRecord(container.securityContext) ?? {};
    container.securityContext = sc;
    if (sc.readOnlyRootFilesystem !== true) sc.readOnlyRootFilesystem = true;
  }
  const mutatedYaml = stringifyYaml(manifest);

  const passedCount = findings.filter((f) => f.passed).length;
  const failedCount = findings.filter((f) => !f.passed).length;
  const score = findings.length === 0 ? 100 : Math.round((passedCount / findings.length) * 100);
  const highFailed = findings.some((f) => !f.passed && f.severity === 'HIGH');

  return {
    totalRules: findings.length,
    passedRules: passedCount,
    failedRules: failedCount,
    score,
    compliant: !highFailed && score >= 80,
    findings,
    mutatedYaml,
  };
}
