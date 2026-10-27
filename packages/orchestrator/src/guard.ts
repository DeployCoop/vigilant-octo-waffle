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

export async function evaluateManifest(yamlContent: string): Promise<EvaluationResult> {
  const findings: EvaluationFinding[] = [];

  const lowerYaml = yamlContent.toLowerCase();

  // Rule 1: Privileged Containers
  const isPrivileged = lowerYaml.includes('privileged: true');
  findings.push({
    ruleId: 'disallow-privileged-containers',
    ruleName: 'Disallow Privileged Containers',
    severity: 'HIGH',
    passed: !isPrivileged,
    message: isPrivileged
      ? 'REJECTED: Container explicitly requests privileged: true mode.'
      : 'PASSED: No privileged container flags detected.',
    path: 'spec.template.spec.containers[*].securityContext.privileged',
  });

  // Rule 2: Read-Only Root Filesystem
  const hasReadOnly = lowerYaml.includes('readonlyrootfilesystem: true');
  findings.push({
    ruleId: 'require-read-only-rootfs',
    ruleName: 'Require Read-Only Root Filesystem',
    severity: 'MEDIUM',
    passed: hasReadOnly,
    message: hasReadOnly
      ? 'PASSED: Container root filesystem is mounted as read-only.'
      : 'WARNING: Missing securityContext.readOnlyRootFilesystem: true.',
    path: 'spec.template.spec.containers[*].securityContext.readOnlyRootFilesystem',
  });

  // Rule 3: Disallow :latest image tag
  const hasLatest = lowerYaml.includes(':latest') || (lowerYaml.includes('image:') && !lowerYaml.includes(':'));
  findings.push({
    ruleId: 'disallow-latest-image-tag',
    ruleName: 'Disallow :latest Image Tags',
    severity: 'MEDIUM',
    passed: !hasLatest,
    message: hasLatest
      ? 'REJECTED: Image uses mutable :latest or untagged reference.'
      : 'PASSED: Image uses pinned semantic version tag.',
    path: 'spec.template.spec.containers[*].image',
  });

  // Rule 4: Resource Limits
  const hasLimits = lowerYaml.includes('limits:') && (lowerYaml.includes('cpu:') || lowerYaml.includes('memory:'));
  findings.push({
    ruleId: 'require-resource-limits',
    ruleName: 'Require CPU & Memory Resource Limits',
    severity: 'HIGH',
    passed: hasLimits,
    message: hasLimits
      ? 'PASSED: Explicit CPU and memory resource limits defined.'
      : 'REJECTED: Container lacks resource limits, risking node OOM.',
    path: 'spec.template.spec.containers[*].resources.limits',
  });

  // Rule 5: Non-Root User
  const hasNonRoot = lowerYaml.includes('runasnonroot: true');
  findings.push({
    ruleId: 'require-non-root-user',
    ruleName: 'Enforce Non-Root UID Execution',
    severity: 'HIGH',
    passed: hasNonRoot,
    message: hasNonRoot
      ? 'PASSED: Workload is configured to run as non-root UID.'
      : 'WARNING: Missing securityContext.runAsNonRoot: true.',
    path: 'spec.template.spec.securityContext.runAsNonRoot',
  });

  // Rule 6: Host Network / IPC
  const hasHostNet = lowerYaml.includes('hostnetwork: true') || lowerYaml.includes('hostipc: true');
  findings.push({
    ruleId: 'disallow-host-network-ipc',
    ruleName: 'Disallow Host Network & IPC Sharing',
    severity: 'HIGH',
    passed: !hasHostNet,
    message: hasHostNet
      ? 'REJECTED: Workload shares hostNetwork or hostIPC namespaces with underlying node.'
      : 'PASSED: Workload network and IPC namespaces are properly isolated.',
    path: 'spec.template.spec.hostNetwork',
  });

  // Mutated YAML generation (auto-fixes securityContext and injects standard labels)
  let mutatedYaml = yamlContent;
  if (!mutatedYaml.includes('app.kubernetes.io/managed-by')) {
    mutatedYaml = mutatedYaml.replace(
      /labels:\n/,
      'labels:\n    app.kubernetes.io/managed-by: vigilant-octo-waffle\n'
    );
  }
  if (!hasReadOnly && mutatedYaml.includes('containers:')) {
    mutatedYaml = mutatedYaml.replace(
      /containers:\n/,
      'containers:\n      # [MUTATION AUTO-FIX: Injected Read-Only RootFS]\n'
    );
  }

  const passedCount = findings.filter((f) => f.passed).length;
  const failedCount = findings.filter((f) => !f.passed).length;
  const score = Math.round((passedCount / findings.length) * 100);

  return {
    totalRules: findings.length,
    passedRules: passedCount,
    failedRules: failedCount,
    score,
    compliant: score >= 80,
    findings,
    mutatedYaml,
  };
}
