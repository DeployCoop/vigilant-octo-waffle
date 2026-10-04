import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { discoverClusterNamespaces, generateNamespaceManifests } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'namespaces:manage');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const result = discoverClusterNamespaces(root);
    const manifests = generateNamespaceManifests(result.namespaces);

    return NextResponse.json({
      total: result.total,
      namespaces: result.namespaces,
      byCategory: result.byCategory,
      manifests,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
