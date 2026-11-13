import { NextResponse } from 'next/server';
import {
  auditSecretsAndLeaks,
  rotateSecretCredential,
  generateSealedSecretManifest,
  secretopsRotateSchema,
  secretopsSealedSchema,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'secrets:read');
  if (denied) return denied;

  try {
    const report = await auditSecretsAndLeaks();
    return NextResponse.json(report);
  } catch (err) {
    return routeError(err, {
      route: 'GET /api/secretops',
      fallbackMessage: 'Failed to audit secrets and leaks',
    });
  }
}

export async function POST(req: Request) {
  // BUG FIX (bug hunt B4): rotation and sealed-secret generation mutate
  // credentials, so they require the manage permission, not the read one.
  const denied = await authorizeRequest(req, 'secrets:manage');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { action, keyValues } = body;

    if (action === 'rotate') {
      // C7: names must be valid K8s names (subdomain for the secret, label
      // for the namespace).
      const { secretName, namespace } = secretopsRotateSchema.parse(body);
      const result = await rotateSecretCredential(secretName, namespace);
      return NextResponse.json(result);
    } else if (action === 'generate_sealed') {
      const { secretName, namespace } = secretopsSealedSchema.parse(body);
      // BUG FIX (bug hunt B2): no default credential. An omitted or
      // empty keyValues object used to mint a "sealed" credential with
      // the public password 'changeme123'.
      if (
        !keyValues ||
        typeof keyValues !== 'object' ||
        Array.isArray(keyValues) ||
        Object.keys(keyValues).length === 0
      ) {
        return apiError(400, 'keyValues (a non-empty object) is required for sealed secret');
      }
      // BUG FIX (bug hunt B1): generateSealedSecretManifest refuses to
      // emit a fake sealed manifest — it throws. Surface that as 501
      // (not implemented) with its message, and never return a manifest
      // or any plaintext-derived content.
      try {
        const manifest = generateSealedSecretManifest(secretName, namespace, keyValues);
        return NextResponse.json({ success: true, manifest });
      } catch (err) {
        return apiError(501, err instanceof Error ? err.message : 'SealedSecret generation is not implemented');
      }
    } else {
      return apiError(400, `Unknown action: ${action}. Expected rotate or generate_sealed`);
    }
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/secretops',
      fallbackMessage: 'SecretOps action failed',
    });
  }
}
