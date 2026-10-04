import { NextResponse } from 'next/server';
import * as os from 'node:os';
import { loadProjectConfig, APP_CATALOG } from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'system:manage');
  if (denied) return denied;

  try {
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;

    const totalMemMb = Math.round(totalMemBytes / (1024 * 1024));
    const freeMemMb = Math.round(freeMemBytes / (1024 * 1024));
    const usedMemMb = Math.round(usedMemBytes / (1024 * 1024));

    const cpus = os.cpus();
    const cpuCount = cpus.length;
    const cpuModel = cpus[0]?.model || 'Unknown';

    // Calculate memory requirements of enabled apps in current config
    const projectRoot = process.env.VOW_PROJECT_ROOT || process.cwd();
    let enabledAppIds: string[] = [];
    try {
      const config = loadProjectConfig(projectRoot);
      enabledAppIds = APP_CATALOG.filter(
        (app) => config.enablers[app.enablerVar] ?? true
      ).map((app) => app.id);
    } catch {
      // fallback
    }

    const catalogMap = new Map(APP_CATALOG.map((a) => [a.id, a]));
    let estimatedClusterMemMb = 0;
    for (const id of enabledAppIds) {
      const app = catalogMap.get(id);
      if (app && app.estimatedMemoryMb) {
        estimatedClusterMemMb += app.estimatedMemoryMb;
      }
    }

    return NextResponse.json({
      system: {
        totalMemMb,
        freeMemMb,
        usedMemMb,
        cpuCount,
        cpuModel,
        platform: os.platform(),
        arch: os.arch(),
        uptime: Math.round(os.uptime()),
        loadAvg: os.loadavg(),
      },
      workload: {
        enabledCount: enabledAppIds.length,
        estimatedClusterMemMb,
        percentOfHostRam: Math.round((estimatedClusterMemMb / totalMemMb) * 100),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
