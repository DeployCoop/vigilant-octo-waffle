import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { discoverClusterNamespaces, generateNamespaceManifests } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

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
  } catch (err) {
    return routeError(err, { route: 'GET /api/namespaces' });
  }
}
