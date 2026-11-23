import { NextResponse } from 'next/server';
import {
  getMigrationStatus,
  lintDdlScript,
  executeZeroDowntimeMigration,
  migrateLintSchema,
  migrateExecuteSchema,
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
  try {
    const body = await req.json();
    const { action } = body;

    // BUG FIX (bug hunt B6): linting is read-only analysis and stays
    // on data:query, but executing a migration now requires the new
    // data:migrate permission — the old single gate let any data:query
    // holder apply migrations.
    if (action === 'execute') {
      const denied = await authorizeRequest(req, 'data:migrate');
      if (denied) return denied;
    } else {
      const denied = await authorizeRequest(req, 'data:query');
      if (denied) return denied;
    }

    if (action === 'lint') {
      // C7: sql validated inside the branch, after the data:query gate.
      const { sql } = migrateLintSchema.parse(body);
      const lintResult = await lintDdlScript(sql);
      return NextResponse.json({ success: true, lintResult });
    } else if (action === 'execute') {
      // C7: version validated inside the branch, after the data:migrate gate.
      const { version } = migrateExecuteSchema.parse(body);
      // BUG FIX (bug hunt B6): a migration may not execute without a
      // clean lint. Studio wiring (Batch C): the lint now runs inside
      // executeZeroDowntimeMigration on the migration file's own DDL —
      // the caller sends no SQL, so the recorded checksum always
      // matches what actually ran. A BLOCKER finding rejects the
      // execution before any snapshot or DDL runs.
      const execResult = await executeZeroDowntimeMigration(version);
      // C8: failures map to their own status instead of collapsing to
      // one code — unknown version 404, blocked 400, failed 500.
      if (!execResult.success) {
        const status =
          execResult.errorKind === 'not_found' ? 404 : execResult.errorKind === 'blocked' ? 400 : 500;
        return apiError(status, execResult.message);
      }
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
