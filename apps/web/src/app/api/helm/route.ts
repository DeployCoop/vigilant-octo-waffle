import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot } from '@/lib/project';
import {
  listHelmReleases,
  getHelmReleaseValues,
  listLocalCharts,
  getLocalChartDetail,
  installLocalChart,
  uninstallLocalChart,
  lintLocalChart,
  templateLocalChart,
  getChartsDirectory,
  setChartsDirectory,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'helm:manage');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const customDir = searchParams.get('customDir') || undefined;

    // 1. Get single local chart details
    const chartId = searchParams.get('chartId');
    if (chartId) {
      const detail = getLocalChartDetail(root, chartId, customDir);
      if (!detail) {
        return apiError(404, `Local chart '${chartId}' not found`);
      }

      // Optional lint check on fetch
      if (searchParams.get('lint') === 'true') {
        const lintResult = await lintLocalChart(root, chartId, customDir);
        return NextResponse.json({ chart: detail, lint: lintResult });
      }

      // Optional template preview on fetch
      if (searchParams.get('template') === 'true') {
        const valuesYaml = searchParams.get('values') || undefined;
        const rendered = await templateLocalChart(root, chartId, { valuesYaml, customDir });
        return NextResponse.json({ chart: detail, template: rendered });
      }

      return NextResponse.json({ chart: detail });
    }

    // 2. List local charts
    if (action === 'local-charts' || action === 'charts') {
      const chartsDir = customDir
        ? (path.isAbsolute(customDir) ? customDir : path.resolve(root, customDir))
        : getChartsDirectory(root);

      const charts = listLocalCharts(root, customDir);
      const exists = fs.existsSync(chartsDir);

      return NextResponse.json({
        chartsDir,
        exists,
        charts,
        count: charts.length,
      });
    }

    // 3. Inspect in-cluster release values
    const release = searchParams.get('release');
    const namespace = searchParams.get('namespace');
    if (release && namespace) {
      const values = await getHelmReleaseValues(release, namespace);
      return NextResponse.json({ release, namespace, values });
    }

    // 4. Default: list in-cluster Helm releases + summary of local charts
    const [releases, localCharts] = await Promise.all([
      listHelmReleases(),
      Promise.resolve(listLocalCharts(root)),
    ]);

    const activeChartsDir = getChartsDirectory(root);

    return NextResponse.json({
      releases,
      chartsDir: activeChartsDir,
      localChartsCount: localCharts.length,
      localCharts,
    });
  } catch (err) {
    return routeError(err, { route: 'GET /api/helm' });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    const denied = await authorizeRequest(req, 'helm:manage', {
      namespace: body.namespace,
    });
    if (denied) return denied;

    // Action 1: Change local charts directory
    if (action === 'set-charts-dir') {
      const newDir = body.chartsDir;
      if (!newDir || typeof newDir !== 'string' || !newDir.trim()) {
        return apiError(400, 'Valid chartsDir string is required');
      }

      const trimmed = newDir.trim();
      const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(root, trimmed);

      // Create directory if user requests it or if it does not exist
      if (!fs.existsSync(resolved) && body.createIfNotExists) {
        fs.mkdirSync(resolved, { recursive: true });
      }

      setChartsDirectory(root, trimmed);
      const charts = listLocalCharts(root, trimmed);

      return NextResponse.json({
        success: true,
        chartsDir: resolved,
        rawDir: trimmed,
        exists: fs.existsSync(resolved),
        chartCount: charts.length,
      });
    }

    // Action 2: Install or Upgrade a local chart
    if (action === 'install' || action === 'upgrade') {
      const { chartId, releaseName, namespace, valuesYaml, wait, timeout, customDir, domain, set } = body;
      if (!chartId) {
        return apiError(400, 'chartId is required');
      }

      const task = installLocalChart(root, chartId, {
        releaseName,
        namespace,
        valuesYaml,
        wait,
        timeout,
        customDir,
        domain,
        set,
      });

      return NextResponse.json({
        success: true,
        taskId: task.id,
        chartId,
        releaseName: releaseName || chartId,
      });
    }

    // Action 3: Uninstall a release
    if (action === 'uninstall') {
      const { releaseName, namespace } = body;
      if (!releaseName) {
        return apiError(400, 'releaseName is required');
      }

      const task = uninstallLocalChart(root, releaseName, namespace || 'default');
      return NextResponse.json({
        success: true,
        taskId: task.id,
        releaseName,
      });
    }

    // Action 4: Run `helm lint`
    if (action === 'lint') {
      const { chartId, customDir } = body;
      if (!chartId) {
        return apiError(400, 'chartId is required');
      }

      const result = await lintLocalChart(root, chartId, customDir);
      return NextResponse.json(result);
    }

    // Action 5: Run `helm template`
    if (action === 'template') {
      const { chartId, releaseName, namespace, valuesYaml, customDir, domain, set } = body;
      if (!chartId) {
        return apiError(400, 'chartId is required');
      }

      const rendered = await templateLocalChart(root, chartId, {
        releaseName,
        namespace,
        valuesYaml,
        customDir,
        domain,
        set,
      });

      return NextResponse.json({ success: true, template: rendered });
    }

    // Action 6: Scaffold example chart into active charts directory
    if (action === 'scaffold-example') {
      const currentDir = getChartsDirectory(root);
      if (!fs.existsSync(currentDir)) {
        fs.mkdirSync(currentDir, { recursive: true });
      }

      const exampleSource = path.join(root, 'example.charts', 'sample-app');
      const targetDir = path.join(currentDir, 'sample-app');

      if (fs.existsSync(exampleSource)) {
        fs.cpSync(exampleSource, targetDir, { recursive: true });
      } else {
        return apiError(404, 'example.charts/sample-app source not found');
      }

      const charts = listLocalCharts(root);
      return NextResponse.json({
        success: true,
        message: 'Successfully populated sample-app into charts directory',
        chartsDir: currentDir,
        charts,
      });
    }

    return apiError(400, 'Invalid action');
  } catch (err) {
    return routeError(err, { route: 'POST /api/helm' });
  }
}
