import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { routeError } from '@/lib/route-error';
import { ProfileManager } from '@vow/orchestrator';
import { authorizeRequest, callerCan } from '@/lib/authz';
import { redactSecrets } from '@/lib/redaction';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'config:read');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name') || 'vow-profile';

    const pm = new ProfileManager(root);
    const bundle = pm.exportProfile(name);

    // Profile bundles carry configuration (and any embedded secrets).
    const canSeeSecrets = await callerCan(req, 'secrets:read');
    return NextResponse.json(canSeeSecrets ? bundle : redactSecrets(bundle));
  } catch (err) {
    return routeError(err, { route: 'GET /api/profiles' });
  }
}

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'config:update');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const bundle = await req.json();

    const pm = new ProfileManager(root);
    pm.importProfile(bundle);

    return NextResponse.json({ success: true, name: bundle.name });
  } catch (err) {
    return routeError(err, { route: 'POST /api/profiles' });
  }
}
