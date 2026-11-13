import { parseYaml, stringifyYaml } from './yaml.js';

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

const policyRules: AdmissionPolicyRule[] = [
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

export async function listAdmissionPolicies(): Promise<AdmissionPolicyRule[]> {
  return [...policyRules];
}

export async function togglePolicyRule(ruleId: string, enabled: boolean): Promise<AdmissionPolicyRule | null> {
  const rule = policyRules.find((r) => r.id === ruleId);
  if (!rule) return null;
  rule.enabled = enabled;
  return { ...rule };
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
export async function evaluateManifest(yamlContent: string): Promise<EvaluationResult> {
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
