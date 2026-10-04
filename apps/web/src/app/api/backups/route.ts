import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  listBackups,
  createVeleroBackup,
  restoreVeleroBackup,
  createDockerNodeSnapshot,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'backups:manage');
  if (denied) return denied;

  try {
    const backups = await listBackups();
    return NextResponse.json({ backups });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, backups: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'backups:manage');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const body = await req.json();
    const { action, name, namespaces, backupName, containerName, snapshotName } = body;

    if (action === 'backup') {
      if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
      const task = createVeleroBackup(name, namespaces, root);
      return NextResponse.json({ success: true, taskId: task.id, name });
    }

    if (action === 'restore') {
      if (!backupName) return NextResponse.json({ error: 'backupName is required' }, { status: 400 });
      const task = restoreVeleroBackup(backupName, root);
      return NextResponse.json({ success: true, taskId: task.id, backupName });
    }

    if (action === 'docker-snapshot') {
      if (!containerName || !snapshotName) {
        return NextResponse.json({ error: 'containerName and snapshotName required' }, { status: 400 });
      }
      const tag = await createDockerNodeSnapshot(containerName, snapshotName);
      return NextResponse.json({ success: true, imageTag: tag });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
