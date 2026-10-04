import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { checkConfig, reconcileConfig } from '@vow/orchestrator';
import { authorizeRequest, callerCan } from '@/lib/authz';
import { redactSecrets } from '@/lib/redaction';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'config:read');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const report = checkConfig(root);
    const canSeeSecrets = await callerCan(req, 'secrets:read');
    return NextResponse.json(canSeeSecrets ? report : redactSecrets(report));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Reconciliation applies fixes to the project config.
  const denied = await authorizeRequest(req, 'config:update');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const body = await req.json().catch(() => ({}));
    const applyFixes = body.applyFixes !== false;
    const report = reconcileConfig(root, { applyFixes });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
