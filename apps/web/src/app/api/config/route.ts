import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { apiError, routeError } from '@/lib/route-error';
import { loadProjectConfig, saveEnvFile } from '@vow/orchestrator';
import { authorizeRequest, callerCan } from '@/lib/authz';
import { redactSecrets } from '@/lib/redaction';

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
