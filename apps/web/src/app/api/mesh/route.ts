import { NextResponse } from 'next/server';
import {
  scanMeshIdentities,
  getMtlsTopology,
  enforceStrictMtls,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'security:read');
  if (denied) return denied;

  try {
    const [identities, links] = await Promise.all([
      scanMeshIdentities(),
      getMtlsTopology(),
    ]);

    return NextResponse.json({
      identities,
      links,
    });
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/mesh',
      fallbackMessage: 'Failed to scan SPIFFE mesh identities',
    });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'security:read');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { namespace } = body;

    if (!namespace) {
      return apiError(400, 'namespace is required');
    }

    const result = await enforceStrictMtls(namespace);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/mesh',
      fallbackMessage: 'Failed to enforce strict mTLS',
    });
  }
}
