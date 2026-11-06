import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { processManager, type TaskRun } from './executor.js';

const execAsync = promisify(exec);
import { execFileAsync, assertK8sLabel, assertK8sObjectName } from './exec-argv.js';

export interface BackupItem {
  id: string;
  name: string;
  type: 'velero' | 'docker-snapshot';
  status: string;
  created: string;
  details?: string;
}

export async function listBackups(): Promise<BackupItem[]> {
  const items: BackupItem[] = [];

  // 1. Check Velero backups
  try {
    const { stdout } = await execAsync('velero backup get -o json');
    const parsed = JSON.parse(stdout);
    if (parsed && Array.isArray(parsed.items)) {
      for (const item of parsed.items) {
        items.push({
          id: `velero-${item.metadata?.name}`,
          name: item.metadata?.name || '',
          type: 'velero',
          status: item.status?.phase || 'Unknown',
          created: item.metadata?.creationTimestamp || '',
          details: `Namespaces: ${(item.spec?.includedNamespaces || ['*']).join(', ')}`,
        });
      }
    }
  } catch {
    // Velero CLI or CRD not available
  }

  // 2. Check local Docker container node snapshots
  try {
    const { stdout } = await execAsync('docker images --filter "reference=vow-snapshot-*" --format "{{.Repository}}:{{.Tag}}||{{.CreatedAt}}||{{.Size}}"');
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [repoTag, created, size] = line.split('||');
      if (repoTag) {
        items.push({
          id: `docker-${repoTag}`,
          name: repoTag,
          type: 'docker-snapshot',
          status: 'Ready',
          created: created || 'Unknown',
          details: `Container Image Snapshot (${size || 'N/A'})`,
        });
      }
    }
  } catch {
    // Docker CLI not available
  }

  return items;
}

export function createVeleroBackup(name: string, namespaces?: string[], cwd?: string): TaskRun {
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  assertK8sObjectName(safeName, 'backup name');
  const args = ['backup', 'create', safeName];
  if (namespaces && namespaces.length > 0) {
    for (const ns of namespaces) {
      assertK8sLabel(ns, 'namespace');
    }
    args.push('--include-namespaces', namespaces.join(','));
  }

  return processManager.runCommand('velero', args, { cwd: cwd || process.cwd() });
}

export function restoreVeleroBackup(backupName: string, cwd?: string): TaskRun {
  assertK8sObjectName(backupName, 'backup name');
  const restoreName = `restore-${backupName}-${Date.now()}`;
  return processManager.runCommand('velero', ['restore', 'create', restoreName, '--from-backup', backupName], {
    cwd: cwd || process.cwd(),
  });
}

export async function createDockerNodeSnapshot(containerName: string, snapshotName: string): Promise<string> {
  if (!containerName || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerName)) {
    throw new Error(`Invalid container name: ${containerName}`);
  }
  const safeSnapshot = snapshotName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  if (!safeSnapshot) {
    throw new Error(`Invalid snapshot name: ${snapshotName}`);
  }
  const tag = `vow-snapshot-${safeSnapshot}:${Date.now()}`;
  await execFileAsync('docker', ['commit', containerName, tag]);
  return tag;
}
