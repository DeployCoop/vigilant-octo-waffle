import { NextResponse } from 'next/server';
import { authorizeRequest, readAuditEntries } from '@/lib/authz';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

/**
 * Reads the authorization audit log (newest first). Restricted to
 * principals holding `users:manage_permissions` — the log reveals who
 * attempted what, including denied attempts.
 */
export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'users:manage_permissions');
  if (denied) return denied;

  const rawLimit = parseInt(new URL(req.url).searchParams.get('limit') ?? '200', 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 200;
  return NextResponse.json({ entries: readAuditEntries(getProjectRoot(), limit) });
}
