import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  APP_CATALOG,
  getCombinedAppCatalog,
  DEPLOYMENT_PRESETS,
  loadProjectConfig,
  saveEnablerFile,
  validateDependencies,
  getTopologicalOrder,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'apps:read');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const domain = config.cluster.domain;
    const catalog = getCombinedAppCatalog(root);

    const enabledAppIds: string[] = [];

    const apps = catalog.map((app) => {
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
  } catch (err) {
    return routeError(err, { route: 'GET /api/apps' });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json();

    // Presets, batch toggles, and single-app toggles all rewrite which
    // apps are enabled for deployment.
    const denied = await authorizeRequest(req, 'apps:deploy');
    if (denied) return denied;

    const config = loadProjectConfig(root);

    // Case 1: Apply a Preset
    if (body.presetId) {
      const preset = DEPLOYMENT_PRESETS.find((p) => p.id === body.presetId);
      if (!preset) {
        return apiError(404, `Preset ${body.presetId} not found`);
      }

      const updatedEnablers: Record<string, boolean> = {};
      const presetAppSet = new Set(preset.apps);
      const catalog = getCombinedAppCatalog(root);

      for (const app of catalog) {
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
      const catalog = getCombinedAppCatalog(root);

      for (const app of catalog) {
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
      return apiError(400, 'Missing enablerVar or presetId');
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
  } catch (err) {
    return routeError(err, { route: 'POST /api/apps' });
  }
}
