import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { applyClusterNamespaces } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'namespaces:manage');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const result = await applyClusterNamespaces(root, { dryRun });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
