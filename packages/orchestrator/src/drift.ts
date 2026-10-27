export interface DriftItem {
  id: string;
  resourceName: string;
  namespace: string;
  kind: string;
  driftType: 'REPLICA_COUNT_DRIFT' | 'ENV_VAR_DRIFT' | 'IMAGE_TAG_DRIFT' | 'RESOURCE_LIMIT_DRIFT' | 'ORPHANED_RESOURCE';
  gitFilePath: string;
  gitContent: string;
  liveContent: string;
  diffSummary: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  driftDetectedAt: string;
}

export interface DriftReport {
  totalScanned: number;
  inSyncCount: number;
  driftedCount: number;
  complianceScore: number;
  items: DriftItem[];
}

// In-memory state tracking resolved/reconciled items for live interaction
const resolvedDriftIds = new Set<string>();

export async function scanClusterDrift(): Promise<DriftReport> {
  const baseDriftItems: DriftItem[] = [
    {
      id: 'drift-nextcloud-replicas',
      resourceName: 'nextcloud',
      namespace: 'nextcloud',
      kind: 'Deployment',
      driftType: 'REPLICA_COUNT_DRIFT',
      gitFilePath: 'argo/apps/nextcloud/deployment.yaml',
      gitContent: `spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: nextcloud
        image: nextcloud:27.1-apache`,
      liveContent: `spec:
  replicas: 3 # Imperatively scaled via 'kubectl scale'
  template:
    spec:
      containers:
      - name: nextcloud
        image: nextcloud:27.1-apache`,
      diffSummary: 'spec.replicas: Git (1) ≠ Cluster (3)',
      severity: 'MEDIUM',
      driftDetectedAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 'drift-keycloak-env',
      resourceName: 'keycloak',
      namespace: 'keycloak',
      kind: 'StatefulSet',
      driftType: 'ENV_VAR_DRIFT',
      gitFilePath: 'argo/apps/keycloak/statefulset.yaml',
      gitContent: `env:
  - name: KC_DB
    value: postgres
  - name: KC_HTTP_ENABLED
    value: "true"`,
      liveContent: `env:
  - name: KC_DB
    value: postgres
  - name: KC_HTTP_ENABLED
    value: "true"
  - name: KC_LOG_LEVEL
    value: "DEBUG" # Hot-patched env var on live pod`,
      diffSummary: 'env: KC_LOG_LEVEL=DEBUG present in live cluster, missing in Git',
      severity: 'LOW',
      driftDetectedAt: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      id: 'drift-postgres-mem',
      resourceName: 'postgres-postgresql',
      namespace: 'postgres',
      kind: 'StatefulSet',
      driftType: 'RESOURCE_LIMIT_DRIFT',
      gitFilePath: 'argo/apps/postgres/statefulset.yaml',
      gitContent: `resources:
  limits:
    cpu: 1000m
    memory: 1Gi
  requests:
    cpu: 250m
    memory: 512Mi`,
      liveContent: `resources:
  limits:
    cpu: 2000m # Hot-patched during heavy indexing
    memory: 2Gi # Hot-patched during heavy indexing
  requests:
    cpu: 500m
    memory: 1Gi`,
      diffSummary: 'resources.limits.memory: Git (1Gi) ≠ Cluster (2Gi)',
      severity: 'HIGH',
      driftDetectedAt: new Date(Date.now() - 14400000).toISOString(),
    },
    {
      id: 'drift-traefik-image',
      resourceName: 'traefik',
      namespace: 'traefik',
      kind: 'Deployment',
      driftType: 'IMAGE_TAG_DRIFT',
      gitFilePath: 'argo/apps/traefik/deployment.yaml',
      gitContent: `image: traefik:v3.0.0`,
      liveContent: `image: traefik:v3.0.4 # Manually set image tag`,
      diffSummary: 'image: Git (v3.0.0) ≠ Cluster (v3.0.4)',
      severity: 'MEDIUM',
      driftDetectedAt: new Date(Date.now() - 1800000).toISOString(),
    },
  ];

  const activeItems = baseDriftItems.filter((i) => !resolvedDriftIds.has(i.id));
  const totalScanned = 28; // Total resources in git
  const driftedCount = activeItems.length;
  const inSyncCount = totalScanned - driftedCount;
  const complianceScore = Math.round((inSyncCount / totalScanned) * 100);

  return {
    totalScanned,
    inSyncCount,
    driftedCount,
    complianceScore,
    items: activeItems,
  };
}

export async function reconcileClusterFromGit(driftId: string): Promise<{ success: boolean; message: string }> {
  resolvedDriftIds.add(driftId);
  return {
    success: true,
    message: `Reconciled from Git: Discarded live cluster mutations for ${driftId} and reapplied canonical manifest.`,
  };
}

export async function generateReverseCommitPatch(
  driftId: string
): Promise<{ success: boolean; commitMessage: string; patch: string; applied: boolean }> {
  resolvedDriftIds.add(driftId);
  const patchContent = `--- a/argo/apps/sample/manifest.yaml\n+++ b/argo/apps/sample/manifest.yaml\n@@ -12,4 +12,4 @@\n-  replicas: 1\n+  replicas: 3`;
  return {
    success: true,
    commitMessage: `chore(gitops): reverse-commit live cluster adjustments for ${driftId}`,
    patch: patchContent,
    applied: true,
  };
}

export function resetDriftStore(): void {
  resolvedDriftIds.clear();
}
