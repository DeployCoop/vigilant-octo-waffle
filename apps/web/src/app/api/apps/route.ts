import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { APP_CATALOG, loadProjectConfig, saveEnablerFile } from '@vow/orchestrator';

export async function GET() {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const domain = config.cluster.domain;

    const apps = APP_CATALOG.map((app) => {
      const isEnabled = config.enablers[app.enablerVar] ?? true;
      const ingressUrl = app.subdomain ? `https://${app.subdomain}.${domain}` : undefined;

      return {
        ...app,
        enabled: isEnabled,
        ingressUrl,
      };
    });

    return NextResponse.json({
      domain,
      apps,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const { enablerVar, enabled } = await req.json();

    if (!enablerVar) {
      return NextResponse.json({ error: 'Missing enablerVar' }, { status: 400 });
    }

    const config = loadProjectConfig(root);
    const updatedEnablers = {
      ...config.enablers,
      [enablerVar.toUpperCase()]: Boolean(enabled),
    };

    saveEnablerFile(root, updatedEnablers);

    return NextResponse.json({
      success: true,
      enablerVar,
      enabled: Boolean(enabled),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
