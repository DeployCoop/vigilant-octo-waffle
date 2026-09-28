import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  APP_CATALOG,
  DEPLOYMENT_PRESETS,
  loadProjectConfig,
  saveEnablerFile,
  validateDependencies,
  getTopologicalOrder,
} from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const domain = config.cluster.domain;

    const enabledAppIds: string[] = [];

    const apps = APP_CATALOG.map((app) => {
      const isEnabled = config.enablers[app.enablerVar] ?? true;
      if (isEnabled) {
        enabledAppIds.push(app.id);
      }
      const ingressUrl = app.subdomain ? `https://${app.subdomain}.${domain}` : undefined;

      return {
        ...app,
        enabled: isEnabled,
        ingressUrl,
      };
    });

    const validation = validateDependencies(enabledAppIds);
    const topologicalOrder = getTopologicalOrder(enabledAppIds);

    return NextResponse.json({
      domain,
      cdRunner: config.cluster.cdRunner || 'argocd',
      apps,
      presets: DEPLOYMENT_PRESETS,
      validation,
      topologicalOrder,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json();
    const config = loadProjectConfig(root);

    // Case 1: Apply a Preset
    if (body.presetId) {
      const preset = DEPLOYMENT_PRESETS.find((p) => p.id === body.presetId);
      if (!preset) {
        return NextResponse.json({ error: `Preset ${body.presetId} not found` }, { status: 404 });
      }

      const updatedEnablers: Record<string, boolean> = {};
      const presetAppSet = new Set(preset.apps);

      for (const app of APP_CATALOG) {
        updatedEnablers[app.enablerVar] = presetAppSet.has(app.id);
      }

      saveEnablerFile(root, updatedEnablers);
      return NextResponse.json({
        success: true,
        presetId: body.presetId,
        enabledCount: preset.apps.length,
      });
    }

    // Case 2: Batch App IDs
    if (Array.isArray(body.appIds)) {
      const targetAppSet = new Set(body.appIds);
      const updatedEnablers: Record<string, boolean> = {};

      for (const app of APP_CATALOG) {
        updatedEnablers[app.enablerVar] = targetAppSet.has(app.id);
      }

      saveEnablerFile(root, updatedEnablers);
      return NextResponse.json({
        success: true,
        enabledCount: body.appIds.length,
      });
    }

    // Case 3: Single App Toggle
    const { enablerVar, enabled } = body;
    if (!enablerVar) {
      return NextResponse.json({ error: 'Missing enablerVar or presetId' }, { status: 400 });
    }

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
