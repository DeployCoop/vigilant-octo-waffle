import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface SecurityFinding {
  id: string;
  category: 'Workload Hardening' | 'Network & TLS' | 'RBAC & Identity' | 'Resource Quotas';
  severity: 'critical' | 'high' | 'medium' | 'low';
  resourceName: string;
  namespace: string;
  title: string;
  description: string;
  remediation: string;
}

export interface SecurityAuditReport {
  score: number; // 0-100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  timestamp: string;
  findings: SecurityFinding[];
  totals: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    scannedPods: number;
    scannedIngresses: number;
  };
}

export async function scanClusterSecurity(): Promise<SecurityAuditReport> {
  const findings: SecurityFinding[] = [];
  let scannedPods = 0;
  let scannedIngresses = 0;

  // 1. Scan Pods
  try {
    const { stdout } = await execAsync('kubectl get pods -A -o json 2>/dev/null');
    const parsed = JSON.parse(stdout);
    const pods = parsed.items || [];
    scannedPods = pods.length;

    for (const pod of pods) {
      const ns = pod.metadata?.namespace || '';
      const name = pod.metadata?.name || '';
      const containers = pod.spec?.containers || [];

      // Check each container
      for (const c of containers) {
        // Check 1: Privileged container
        if (c.securityContext?.privileged) {
          findings.push({
            id: `privileged-${ns}-${name}-${c.name}`,
            category: 'Workload Hardening',
            severity: 'critical',
            resourceName: `${name} (${c.name})`,
            namespace: ns,
            title: 'Privileged Container Execution',
            description: 'Container runs with host-level privileges and can disable namespace isolation.',
            remediation: 'Set securityContext.privileged: false unless running core storage/kernel drivers.',
          });
        }

        // Check 2: Run as root
        if (c.securityContext?.runAsUser === 0 || (!c.securityContext?.runAsNonRoot && !c.securityContext?.runAsUser)) {
          findings.push({
            id: `root-${ns}-${name}-${c.name}`,
            category: 'Workload Hardening',
            severity: 'medium',
            resourceName: `${name} (${c.name})`,
            namespace: ns,
            title: 'Container May Run As Root (UID 0)',
            description: 'Container securityContext does not enforce runAsNonRoot.',
            remediation: 'Configure securityContext.runAsNonRoot: true and define a non-zero runAsUser.',
          });
        }

        // Check 3: Missing resource limits
        if (!c.resources?.limits?.memory || !c.resources?.limits?.cpu) {
          findings.push({
            id: `limits-${ns}-${name}-${c.name}`,
            category: 'Resource Quotas',
            severity: 'low',
            resourceName: `${name} (${c.name})`,
            namespace: ns,
            title: 'Missing CPU or Memory Limits',
            description: 'Container does not declare resource limits and could cause node memory exhaustion (OOM).',
            remediation: 'Define resources.limits.cpu and resources.limits.memory in pod template.',
          });
        }
      }
    }
  } catch {}

  // 2. Scan Ingresses for TLS
  try {
    const { stdout } = await execAsync('kubectl get ingress -A -o json 2>/dev/null');
    const parsed = JSON.parse(stdout);
    const ingresses = parsed.items || [];
    scannedIngresses = ingresses.length;

    for (const ing of ingresses) {
      const ns = ing.metadata?.namespace || '';
      const name = ing.metadata?.name || '';
      const tls = ing.spec?.tls || [];

      if (tls.length === 0) {
        findings.push({
          id: `ingress-tls-${ns}-${name}`,
          category: 'Network & TLS',
          severity: 'high',
          resourceName: name,
          namespace: ns,
          title: 'Ingress Missing TLS Termination',
          description: 'Ingress route is configured without TLS encryption, transmitting traffic in cleartext.',
          remediation: 'Add spec.tls section with secretName or enable cert-manager cluster-issuer annotations.',
        });
      }
    }
  } catch {}

  // Calculate score (100 base)
  let score = 100;
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  for (const f of findings) {
    if (f.severity === 'critical') {
      score -= 15;
      criticalCount++;
    } else if (f.severity === 'high') {
      score -= 8;
      highCount++;
    } else if (f.severity === 'medium') {
      score -= 4;
      mediumCount++;
    } else if (f.severity === 'low') {
      score -= 1;
      lowCount++;
    }
  }

  score = Math.max(20, Math.min(100, score));

  let grade: SecurityAuditReport['grade'] = 'F';
  if (score >= 95) grade = 'A+';
  else if (score >= 88) grade = 'A';
  else if (score >= 78) grade = 'B';
  else if (score >= 68) grade = 'C';
  else if (score >= 55) grade = 'D';

  return {
    score,
    grade,
    timestamp: new Date().toISOString(),
    findings,
    totals: {
      critical: criticalCount,
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      scannedPods,
      scannedIngresses,
    },
  };
}
