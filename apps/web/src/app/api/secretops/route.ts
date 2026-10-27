import { NextResponse } from 'next/server';
import {
  auditSecretsAndLeaks,
  rotateSecretCredential,
  generateSealedSecretManifest,
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
  const denied = await authorizeRequest(req, 'secrets:read');
  if (denied) return denied;

  try {
    const body = await req.json();
    const { action, secretName, namespace, keyValues } = body;

    if (action === 'rotate') {
      if (!secretName || !namespace) {
        return apiError(400, 'secretName and namespace are required for rotation');
      }
      const result = await rotateSecretCredential(secretName, namespace);
      return NextResponse.json(result);
    } else if (action === 'generate_sealed') {
      if (!secretName || !namespace) {
        return apiError(400, 'secretName and namespace are required for sealed secret');
      }
      const manifest = generateSealedSecretManifest(
        secretName,
        namespace,
        keyValues || { password: 'changeme123' }
      );
      return NextResponse.json({ success: true, manifest });
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
