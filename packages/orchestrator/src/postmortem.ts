export interface IncidentEvent {
  timestamp: string;
  eventType: 'OOM_KILLED' | 'CRASH_LOOP' | 'POD_EVICTION' | 'TRACE_LATENCY_SPIKE' | 'CHAOS_FAULT';
  workload: string;
  namespace: string;
  description: string;
}

export interface PostmortemActionItem {
  id: string;
  title: string;
  owner: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface PostmortemReport {
  id: string;
  incidentTitle: string;
  severity: 'SEV-1' | 'SEV-2' | 'SEV-3';
  detectedAt: string;
  resolvedAt: string;
  durationMinutes: number;
  affectedWorkloads: string[];
  rootCause: string;
  timeline: IncidentEvent[];
  actionItems: PostmortemActionItem[];
  fullReportMarkdown: string;
}

const postmortemsStore: PostmortemReport[] = [
  {
    id: 'pm-2026-09-01',
    incidentTitle: 'PostgreSQL Buffer Pool Memory Exhaustion & Cascading 504s',
    severity: 'SEV-1',
    detectedAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    resolvedAt: new Date(Date.now() - 47.5 * 3600000).toISOString(),
    durationMinutes: 30,
    affectedWorkloads: ['postgres-postgresql-0', 'keycloak-0', 'nextcloud-769c8f94cb-k4'],
    rootCause: 'Unbounded background indexing triggered cgroup OOMKiller on PostgreSQL primary.',
    timeline: [
      {
        timestamp: '14:02:10 UTC',
        eventType: 'TRACE_LATENCY_SPIKE',
        workload: 'traefik',
        namespace: 'traefik',
        description: 'P99 Ingress latency spiked from 24ms to 1250ms.',
      },
      {
        timestamp: '14:05:40 UTC',
        eventType: 'OOM_KILLED',
        workload: 'postgres-postgresql-0',
        namespace: 'postgres',
        description: 'Kernel cgroup invoked OOMKiller on postgres daemon (memory limit: 1Gi exceeded).',
      },
      {
        timestamp: '14:06:15 UTC',
        eventType: 'CRASH_LOOP',
        workload: 'keycloak-0',
        namespace: 'keycloak',
        description: 'Connection pool exhausted waiting for TCP socket on 5432.',
      },
      {
        timestamp: '14:32:00 UTC',
        eventType: 'POD_EVICTION',
        workload: 'postgres-postgresql-0',
        namespace: 'postgres',
        description: 'Kubelet rescheduled healthy replica with 2Gi limit buffer.',
      },
    ],
    actionItems: [
      { id: 'act-01', title: 'Raise PostgreSQL memory limits to 2Gi in Helm values', owner: 'Platform Team', status: 'COMPLETED' },
      { id: 'act-02', title: 'Add KEDA connection pool scaler for read replicas', owner: 'DevOps', status: 'IN_PROGRESS' },
      { id: 'act-03', title: 'Configure Prometheus memory saturation alerting threshold at 85%', owner: 'SRE Team', status: 'COMPLETED' },
    ],
    fullReportMarkdown: `# Blameless Incident Post-Mortem: PostgreSQL Buffer Pool Memory Exhaustion
**Date:** 2026-09-26 | **Severity:** SEV-1 | **Duration:** 30 minutes

## 1. Executive Summary
Between 14:02 UTC and 14:32 UTC, the primary database instance suffered an out-of-memory kill event. Downstream authentication and file sync services experienced cascading timeouts for 30 minutes until pod restart completed.

## 2. Root Cause Analysis (5 Whys)
1. **Why did service fail?** Nextcloud and Keycloak could not query the database.
2. **Why was DB down?** Postgres pod terminated with exit code 137 (OOM).
3. **Why did memory spike?** A large unindexed table query buffered entire disk tables into RAM.
4. **Why was RAM capped too low?** Container memory limit was set to 1Gi while shared_buffers was configured at 768MB.
5. **Why was this missed?** Admission governance did not enforce buffer headroom ratio.

## 3. Action Items
- [x] Bump memory limits to 2Gi in values.yaml
- [ ] Implement KEDA connection-based autoscale trigger
- [x] Configure Prometheus proactive saturation alerts
`,
  },
];

export async function listHistoricalPostmortems(): Promise<PostmortemReport[]> {
  return [...postmortemsStore];
}

export async function generatePostmortem(params: {
  incidentTitle: string;
  affectedWorkloads: string[];
  severity: 'SEV-1' | 'SEV-2' | 'SEV-3';
}): Promise<PostmortemReport> {
  const id = `pm-${Date.now().toString().slice(-6)}`;
  const now = new Date();
  const detected = new Date(now.getTime() - 25 * 60 * 1000);

  const timeline: IncidentEvent[] = [
    {
      timestamp: 'T-25m',
      eventType: 'TRACE_LATENCY_SPIKE',
      workload: params.affectedWorkloads[0] || 'ingress-gateway',
      namespace: 'default',
      description: 'Trace waterfall registered abnormal latency increase across dependent microservices.',
    },
    {
      timestamp: 'T-20m',
      eventType: 'CHAOS_FAULT',
      workload: params.affectedWorkloads[0] || 'app-workload',
      namespace: 'default',
      description: 'Transient packet loss and socket resets observed on egress interface.',
    },
    {
      timestamp: 'T-12m',
      eventType: 'CRASH_LOOP',
      workload: params.affectedWorkloads[1] || params.affectedWorkloads[0] || 'worker-pool',
      namespace: 'default',
      description: 'Liveness probes timed out resulting in automated pod restarts.',
    },
    {
      timestamp: 'T-0m',
      eventType: 'POD_EVICTION',
      workload: params.affectedWorkloads[0] || 'app-workload',
      namespace: 'default',
      description: 'Self-healing GitOps reconciliation restored target replica count to 100% ready.',
    },
  ];

  const reportMd = `# Blameless Post-Mortem: ${params.incidentTitle}
**ID:** ${id} | **Severity:** ${params.severity} | **Duration:** 25 Minutes

## 1. Executive Summary
On ${now.toISOString().split('T')[0]}, cluster observability detected performance degradation in [${params.affectedWorkloads.join(', ')}]. Autonomous failover mechanisms and GitOps reconciliation restored full SLA availability within 25 minutes.

## 2. Root Cause Analysis
- **Primary Trigger:** Unanticipated workload saturation leading to transient resource throttling.
- **Contributing Factor:** Network latency threshold breached before horizontal autoscaling completed.
- **Resolution:** Re-scheduled healthy pods with calibrated resource quotas.

## 3. Action Items
- [ ] Configure predictive KEDA auto-scaling thresholds.
- [ ] Update zero-trust network policies to isolate cross-tenant noisy neighbors.
- [ ] Conduct DR drill verification.
`;

  const newPostmortem: PostmortemReport = {
    id,
    incidentTitle: params.incidentTitle,
    severity: params.severity,
    detectedAt: detected.toISOString(),
    resolvedAt: now.toISOString(),
    durationMinutes: 25,
    affectedWorkloads: params.affectedWorkloads,
    rootCause: `Workload saturation and latency degradation on ${params.affectedWorkloads.join(', ')}.`,
    timeline,
    actionItems: [
      { id: `${id}-1`, title: 'Tune resource request headroom in GitOps manifests', owner: 'SRE', status: 'IN_PROGRESS' },
      { id: `${id}-2`, title: 'Enforce non-blocking connection pool limits', owner: 'Backend Engineering', status: 'OPEN' },
    ],
    fullReportMarkdown: reportMd,
  };

  postmortemsStore.unshift(newPostmortem);
  return newPostmortem;
}
