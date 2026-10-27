export interface ClusterStateSnapshot {
  id: string;
  timestamp: string;
  timeAgo: string;
  gitCommitSha: string;
  commitMessage: string;
  resourceCount: number;
  healthyPercent: number;
  tags: string[];
}

export interface SnapshotDelta {
  resourceName: string;
  namespace: string;
  kind: string;
  changeType: 'ADDED' | 'MODIFIED' | 'REMOVED';
  diffSummary: string;
}

const snapshotsStore: ClusterStateSnapshot[] = [
  {
    id: 'snap-2026-09-28-1800',
    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    timeAgo: '30 minutes ago',
    gitCommitSha: '19fe127',
    commitMessage: 'feat: add 7 Phase-3 DevOps studios',
    resourceCount: 48,
    healthyPercent: 100,
    tags: ['Stable', 'Release'],
  },
  {
    id: 'snap-2026-09-28-1600',
    timestamp: new Date(Date.now() - 2.5 * 3600 * 1000).toISOString(),
    timeAgo: '2.5 hours ago',
    gitCommitSha: '1b04ece',
    commitMessage: 'feat: add 7 next-gen DevOps studios',
    resourceCount: 42,
    healthyPercent: 100,
    tags: ['Milestone'],
  },
  {
    id: 'snap-2026-09-27-2000',
    timestamp: new Date(Date.now() - 22 * 3600 * 1000).toISOString(),
    timeAgo: '22 hours ago',
    gitCommitSha: 'c56189d',
    commitMessage: 'feat: complete next-gen enhancements',
    resourceCount: 36,
    healthyPercent: 98,
    tags: ['Baseline'],
  },
];

export async function listHistoricalSnapshots(): Promise<ClusterStateSnapshot[]> {
  return [...snapshotsStore];
}

export async function compareSnapshotWithLive(snapshotId: string): Promise<{ snapshotId: string; deltas: SnapshotDelta[] }> {
  const target = snapshotsStore.find((s) => s.id === snapshotId) || snapshotsStore[0];

  const deltas: SnapshotDelta[] = [
    {
      resourceName: 'octoguard-admission-webhook',
      namespace: 'kube-system',
      kind: 'ValidatingWebhookConfiguration',
      changeType: 'ADDED',
      diffSummary: 'Resource present in current live cluster but not in historical snapshot.',
    },
    {
      resourceName: 'keycloak',
      namespace: 'keycloak',
      kind: 'StatefulSet',
      changeType: 'MODIFIED',
      diffSummary: 'spec.template.spec.containers[0].resources: Limits updated from 1Gi to 1.5Gi.',
    },
    {
      resourceName: 'legacy-temp-pvc',
      namespace: 'default',
      kind: 'PersistentVolumeClaim',
      changeType: 'REMOVED',
      diffSummary: 'Existed in snapshot, subsequently purged by garbage collector.',
    },
  ];

  return {
    snapshotId: target.id,
    deltas,
  };
}

export async function rewindToSnapshot(
  snapshotId: string
): Promise<{ success: boolean; snapshotId: string; restoredSha: string; message: string }> {
  const target = snapshotsStore.find((s) => s.id === snapshotId);
  if (!target) {
    return { success: false, snapshotId, restoredSha: '', message: `Snapshot ${snapshotId} not found.` };
  }

  return {
    success: true,
    snapshotId: target.id,
    restoredSha: target.gitCommitSha,
    message: `Cluster state rewound to snapshot [${target.id}] (Git commit ${target.gitCommitSha}). Re-synced 42 resources via ArgoCD.`,
  };
}
