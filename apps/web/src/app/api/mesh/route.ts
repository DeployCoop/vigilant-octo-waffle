import { NextResponse } from 'next/server';
import {
  scanMeshIdentities,
  getMtlsTopology,
  enforceStrictMtls,
  meshEnforceSchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { routeError } from '@/lib/route-error';

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
  // BUG FIX (bug hunt B3): enforcing mTLS changes cluster security
  // posture, so it requires the manage permission, not the read one
  // that every viewer holds. GET stays security:read.
  const denied = await authorizeRequest(req, 'security:manage');
  if (denied) return denied;

  try {
    const body = await req.json();
    // C7: namespace must be a DNS-1123 label (C6 builds the policy as an
    // object, so a hostile name can no longer inject YAML fields either way).
    const { namespace } = meshEnforceSchema.parse(body);

    const result = await enforceStrictMtls(namespace);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/mesh',
      fallbackMessage: 'Failed to enforce strict mTLS',
    });
  }
}
