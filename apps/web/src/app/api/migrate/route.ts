import { NextResponse } from 'next/server';
import {
  getMigrationStatus,
  lintDdlScript,
  executeZeroDowntimeMigration,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'data:query');
  if (denied) return denied;

  try {
    const migrations = await getMigrationStatus();
    return NextResponse.json({ migrations });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/migrate',
      fallbackMessage: 'Failed to fetch database migrations',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'data:query');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { action, sql, version } = body;

    if (action === 'lint') {
      if (!sql) {
        return apiError(400, 'sql is required for linting');
      }
      const lintResult = await lintDdlScript(sql);
      return NextResponse.json({ success: true, lintResult });
    } else if (action === 'execute') {
      if (!version) {
        return apiError(400, 'version is required for migration');
      }
      const execResult = await executeZeroDowntimeMigration(version);
      return NextResponse.json(execResult);
    } else {
      return apiError(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/migrate',
      fallbackMessage: 'Database migration operation failed',
    });
  }
}
