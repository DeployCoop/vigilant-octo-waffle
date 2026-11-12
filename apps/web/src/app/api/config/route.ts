import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { apiError, routeError } from '@/lib/route-error';
import { loadProjectConfig, saveEnvFile } from '@vow/orchestrator';
import { authorizeRequest, callerCan } from '@/lib/authz';
import { redactSecrets } from '@/lib/redaction';
import { isSensitiveConfigKey } from '@/lib/sensitive-config';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'config:read');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);

    const payload = {
      config: config.raw,
      cluster: config.cluster,
    };

    // Redaction split (plan Q5): callers without secrets:read get the
    // config with secret values masked.
    const canSeeSecrets = await callerCan(req, 'secrets:read');
    return NextResponse.json(canSeeSecrets ? payload : redactSecrets(payload));
  } catch (err) {
    return routeError(err, { route: 'GET /api/config' });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'config:update');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const { updates } = await req.json();

    if (!updates || typeof updates !== 'object') {
      return apiError(400, 'Invalid updates');
    }

    // Security-sensitive keys need the owner-only permission on top of
    // config:update; otherwise an admin could escalate to owner by
    // persisting a bootstrap credential or redirecting identity trust.
    // (With authz disabled this second check passes, matching the
    // zero-config model; the first gate already passed in that case.)
    if (Object.keys(updates).some(isSensitiveConfigKey)) {
      const deniedSensitive = await authorizeRequest(req, 'users:manage_permissions');
      if (deniedSensitive) return deniedSensitive;
    }

    const currentConfig = loadProjectConfig(root);
    const newRaw = { ...currentConfig.raw, ...updates };

    saveEnvFile(root, newRaw);

    return NextResponse.json({
      success: true,
      updated: Object.keys(updates).length,
    });
  } catch (err) {
    return routeError(err, { route: 'POST /api/config' });
  }
}
