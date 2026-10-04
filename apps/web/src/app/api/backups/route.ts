import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  listBackups,
  createVeleroBackup,
  restoreVeleroBackup,
  createDockerNodeSnapshot,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'backups:manage');
  if (denied) return denied;

  try {
    const backups = await listBackups();
    return NextResponse.json({ backups });
  } catch (err) {
    return routeError(err, { route: 'GET /api/backups' });
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
      if (!name) return apiError(400, 'name is required');
      const task = createVeleroBackup(name, namespaces, root);
      return NextResponse.json({ success: true, taskId: task.id, name });
    }

    if (action === 'restore') {
      if (!backupName) return apiError(400, 'backupName is required');
      const task = restoreVeleroBackup(backupName, root);
      return NextResponse.json({ success: true, taskId: task.id, backupName });
    }

    if (action === 'docker-snapshot') {
      if (!containerName || !snapshotName) {
        return apiError(400, 'containerName and snapshotName required');
      }
      const tag = await createDockerNodeSnapshot(containerName, snapshotName);
      return NextResponse.json({ success: true, imageTag: tag });
    }

    return apiError(400, 'Unknown action');
  } catch (err) {
    return routeError(err, { route: 'POST /api/backups' });
  }
}
