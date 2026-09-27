import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  APP_CATALOG,
  loadProjectConfig,
  probeAllEndpoints,
  listCustomApps,
} from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message, probes: [] }, { status: 500 });
  }
}
