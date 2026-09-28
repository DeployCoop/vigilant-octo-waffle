import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface NetworkPolicyInfo {
  name: string;
  namespace: string;
  policyTypes: ('Ingress' | 'Egress')[];
  podSelector: string;
  ingressRuleCount: number;
  egressRuleCount: number;
  createdAt: string;
}

export interface TrafficConnection {
  source: string;
  target: string;
  status: 'allowed' | 'restricted' | 'isolated';
  description: string;
  policyName?: string;
}

export interface NetworkPolicyReport {
  totalPolicies: number;
  coveredNamespaces: string[];
  unprotectedNamespaces: string[];
  isolationScore: number; // 0-100%
  policies: NetworkPolicyInfo[];
  matrix: TrafficConnection[];
}

export async function scanNetworkPolicies(): Promise<NetworkPolicyReport> {
  const policies: NetworkPolicyInfo[] = [];
  const coveredNs = new Set<string>();
  const allNs = new Set<string>();

  try {
    // 1. Get all namespaces
    const { stdout: nsOut } = await execAsync('kubectl get namespaces -o jsonpath="{.items[*].metadata.name}" 2>/dev/null || true');
    nsOut.trim().split(/\s+/).filter(Boolean).forEach((ns) => allNs.add(ns));

    // 2. Get network policies
    const { stdout: polOut } = await execAsync('kubectl get networkpolicies -A -o json 2>/dev/null || true');
    if (polOut.trim().startsWith('{')) {
      const parsed = JSON.parse(polOut);
      for (const item of parsed.items || []) {
        const name = item.metadata?.name || '';
        const namespace = item.metadata?.namespace || 'default';
        coveredNs.add(namespace);

        const types: ('Ingress' | 'Egress')[] = item.spec?.policyTypes || ['Ingress'];
        const sel = item.spec?.podSelector?.matchLabels
          ? JSON.stringify(item.spec.podSelector.matchLabels)
          : 'all pods';

        policies.push({
          name,
          namespace,
          policyTypes: types,
          podSelector: sel,
          ingressRuleCount: item.spec?.ingress?.length || 0,
          egressRuleCount: item.spec?.egress?.length || 0,
          createdAt: item.metadata?.creationTimestamp || new Date().toISOString(),
        });
      }
    }
  } catch {}

  const allNamespacesArray = Array.from(allNs);
  const unprotectedNamespaces = allNamespacesArray.filter((ns) => !coveredNs.has(ns));
  const isolationScore = allNamespacesArray.length > 0
    ? Math.round((coveredNs.size / allNamespacesArray.length) * 100)
    : 0;

  // Build 2D communication matrix for prominent services/namespaces
  const matrix: TrafficConnection[] = [];
  const relevantNamespaces = ['traefik', 'argocd', 'default', 'minio', 'postgres', 'vault', 'monitoring'];

  for (const src of relevantNamespaces) {
    for (const tgt of relevantNamespaces) {
      if (src === tgt) continue;

      let status: TrafficConnection['status'] = 'allowed';
      let description = 'Default open pod-to-pod network traffic';

      // Traefik Ingress ingress routing
      if (src === 'traefik') {
        status = 'allowed';
        description = 'Ingress Gateway reverse-proxy traffic';
      } else if (tgt === 'postgres' && src !== 'default') {
        // DB isolation check
        const hasPolicy = policies.some((p) => p.namespace === 'postgres');
        status = hasPolicy ? 'restricted' : 'allowed';
        description = hasPolicy ? 'Restricted to authenticated database client callers' : 'Open database port 5432 (Warning: Unshielded)';
      } else if (tgt === 'kube-system') {
        status = 'isolated';
        description = 'Kubernetes internal control plane isolation';
      }

      matrix.push({
        source: src,
        target: tgt,
        status,
        description,
      });
    }
  }

  return {
    totalPolicies: policies.length,
    coveredNamespaces: Array.from(coveredNs),
    unprotectedNamespaces,
    isolationScore,
    policies,
    matrix,
  };
}

export function scaffoldZeroTrustPolicy(appId: string, namespace: string, allowedCallers: string[]): string {
  const callerRules = allowedCallers
    .map(
      (c) => `    - namespaceSelector:\n        matchLabels:\n          kubernetes.io/metadata.name: ${c}`
    )
    .join('\n');

  return `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${appId}-zero-trust-deny
  namespace: ${namespace}
  labels:
    app.kubernetes.io/name: ${appId}
    security.vow.io/managed-by: vigilant-octo-waffle
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: ${appId}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Allow only traffic from designated caller namespaces
${callerRules || '    [] # Default Deny All'}
  egress:
    # Allow internal cluster DNS resolution
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
`;
}
