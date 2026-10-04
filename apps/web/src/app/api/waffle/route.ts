import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  getWaffleSourceManager,
  getWaffleRunner,
  getWaffleRunHistory,
  getBuiltinBlueprints,
  getBlueprintById,
  validateWafflePipeline,
  loadWafflePipeline,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'tasks:read');
  if (denied) return denied;

  try {
    const root = getProjectRoot();
    const sourceManager = getWaffleSourceManager(root);
    const runner = getWaffleRunner(root);
    const runHistory = getWaffleRunHistory(root);

    const { searchParams } = new URL(req.url);
    const sourceId = searchParams.get('sourceId');
    const blueprintId = searchParams.get('blueprintId');
    const validatePath = searchParams.get('validatePath');

    // 1. Validate on-the-fly path
    if (validatePath) {
      try {
        const { pipeline, baseDir } = await loadWafflePipeline(validatePath);
        const validation = validateWafflePipeline(pipeline, baseDir);
        return NextResponse.json({ valid: validation.valid, validation, pipeline });
      } catch (err: any) {
        return NextResponse.json({ valid: false, error: err.message }, { status: 400 });
      }
    }

    // 2. Return specific source pipeline
    if (sourceId) {
      try {
        const { pipeline, source } = await sourceManager.getSourcePipeline(sourceId);
        const validation = validateWafflePipeline(pipeline, source.localPath);
        return NextResponse.json({ pipeline, source, validation });
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
    }

    // 3. Return specific blueprint pipeline
    if (blueprintId) {
      const bp = getBlueprintById(blueprintId);
      if (!bp) {
        return NextResponse.json({ error: `Blueprint "${blueprintId}" not found` }, { status: 404 });
      }
      const validation = validateWafflePipeline(bp);
      return NextResponse.json({ pipeline: bp, validation });
    }

    // 4. Return default studio overview
    const sources = await sourceManager.getSources();
    const blueprints = getBuiltinBlueprints();
    const activeRun = runner.getActiveRun();
    const history = await runHistory.getHistory();

    return NextResponse.json({
      sources,
      blueprints: blueprints.map((b) => ({
        id: b.metadata.name,
        name: b.metadata.name,
        description: b.metadata.description,
        tags: b.metadata.tags,
        stagesCount: b.stages.length,
        stepsCount: b.stages.reduce((acc, s) => acc + s.steps.length, 0),
        pipeline: b,
      })),
      activeRun,
      history,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
