import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { routeError } from '@/lib/route-error';
import { authorizeRequest } from '@/lib/authz';
import {
  APP_CATALOG,
  loadProjectConfig,
  probeAllEndpoints,
  listCustomApps,
} from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Was completely unguarded: unauthenticated callers received the
  // cluster domain, every app's ingress URL and live probe results, and
  // each request triggered a fresh round of outbound probes.
  const denied = await authorizeRequest(req, 'cluster:read');
  if (denied) return denied;
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const domain = config.cluster.domain;

    const customApps = listCustomApps(root);
    const allCatalog = [...APP_CATALOG, ...customApps];

    const appsToProbe = allCatalog.map((app) => {
      const isEnabled = config.enablers[app.enablerVar] ?? true;
      const ingressUrl = app.subdomain ? `https://${app.subdomain}.${domain}` : undefined;
      return {
        id: app.id,
        name: app.name,
        ingressUrl,
        enabled: isEnabled,
      };
    });

    const probeResults = await probeAllEndpoints(appsToProbe);
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      probes: probeResults,
    });
  } catch (err) {
    return routeError(err, { route: 'GET /api/health' });
  }
}
