import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { processManager, type TaskRun } from './executor.js';

const execAsync = promisify(exec);

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
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const args = ['backup', 'create', safeName];
  if (namespaces && namespaces.length > 0) {
    args.push('--include-namespaces', namespaces.join(','));
  }

  return processManager.runCommand('velero', args, { cwd: cwd || process.cwd() });
}

export function restoreVeleroBackup(backupName: string, cwd?: string): TaskRun {
  const restoreName = `restore-${backupName}-${Date.now()}`;
  return processManager.runCommand('velero', ['restore', 'create', restoreName, '--from-backup', backupName], {
    cwd: cwd || process.cwd(),
  });
}

export async function createDockerNodeSnapshot(containerName: string, snapshotName: string): Promise<string> {
  const tag = `vow-snapshot-${snapshotName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}:${Date.now()}`;
  await execAsync(`docker commit ${JSON.stringify(containerName)} ${JSON.stringify(tag)}`);
  return tag;
}
