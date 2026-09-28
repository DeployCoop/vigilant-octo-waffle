import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  APP_CATALOG,
  loadProjectConfig,
  buildTopologyGraph,
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

    const enabledAppIds: string[] = [];
    for (const app of allCatalog) {
      if (config.enablers[app.enablerVar] ?? true) {
        enabledAppIds.push(app.id);
      }
    }

    const graph = buildTopologyGraph(enabledAppIds, domain);
    return NextResponse.json(graph);
  } catch (err: any) {
    return NextResponse.json({ error: err.message, nodes: [], edges: [], layers: [] }, { status: 500 });
  }
}
