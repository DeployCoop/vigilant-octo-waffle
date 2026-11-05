import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { resolveWafflePathInRoot } from '@/lib/waffle-path';
import {
  getWaffleSourceManager,
  getWaffleRunner,
  getBlueprintById,
  loadWafflePipeline,
  validateWafflePipeline,
  type WafflePipeline,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'tasks:run');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const sourceManager = getWaffleSourceManager(root);
    const runner = getWaffleRunner(root);
    const body = await req.json();

    const { sourceId, blueprintId, customPath, dryRun, buildOnly } = body;

    let targetPipeline: WafflePipeline | null = null;
    let targetBaseDir: string = root;
    let effectiveSourceId = sourceId || blueprintId || 'custom';

    if (sourceId) {
      const { pipeline, source } = await sourceManager.getSourcePipeline(sourceId);
      targetPipeline = pipeline;
      targetBaseDir = source.localPath;
      effectiveSourceId = source.id;
    } else if (blueprintId) {
      const bp = getBlueprintById(blueprintId);
      if (!bp) {
        return apiError(404, `Blueprint "${blueprintId}" not found`);
      }
      targetPipeline = bp;
      targetBaseDir = root;
      effectiveSourceId = blueprintId;
    } else if (customPath) {
      // BUG FIX (bug hunt B11): confine ad-hoc pipelines to the
      // project root — an unconfined customPath let a tasks:run holder
      // execute a pipeline file anywhere on disk, bypassing source
      // registration (which requires config:update). A path escaping
      // the root is a client error (400), not a server error.
      let confinedPath: string;
      try {
        confinedPath = resolveWafflePathInRoot(root, customPath);
      } catch {
        return apiError(400, 'customPath must resolve inside the project root');
      }
      const { pipeline, baseDir } = await loadWafflePipeline(confinedPath);
      targetPipeline = pipeline;
      targetBaseDir = baseDir;
      effectiveSourceId = 'custom';
    } else {
      return apiError(
        400,
        'Specify either "sourceId", "blueprintId", or "customPath"'
      );
    }

    if (runner.getActiveRun() && runner.getActiveRun()?.status === 'running') {
      return apiError(
        409,
        'Another pipeline run is currently in progress. Wait for it to finish or abort it first.'
      );
    }

    // BUG FIX (bug hunt B11): validate before executing. The old code
    // launched whatever loadWafflePipeline parsed (which only enforces
    // the YAML schema) without the structural checks — duplicate stage
    // IDs, dangling dependencies, missing local charts.
    const validation = validateWafflePipeline(targetPipeline, targetBaseDir);
    if (!validation.valid) {
      return apiError(
        400,
        `Pipeline validation failed: ${validation.errors.join('; ')}`
      );
    }

    // Launch execution asynchronously in background so client gets instant response
    // and can connect to SSE stream or poll progress
    runner.executePipeline({
      sourceId: effectiveSourceId,
      pipeline: targetPipeline,
      baseDir: targetBaseDir,
      dryRun: Boolean(dryRun),
      buildOnly: Boolean(buildOnly),
    }).catch((err) => {
      console.error('[WaffleRunner] Pipeline execution error:', err);
    });

    // Short delay to allow runner to initialize and emit start
    await new Promise((res) => setTimeout(res, 50));
    const activeRun = runner.getActiveRun();

    return NextResponse.json({
      success: true,
      message: buildOnly
        ? `Started image rebuild for pipeline "${targetPipeline.metadata.name}"`
        : `Started ${dryRun ? 'dry-run of ' : ''}pipeline "${targetPipeline.metadata.name}"`,
      run: activeRun,
    });
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/waffle/run',
      fallbackMessage: 'Failed to start pipeline',
    });
  }
}
