import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { ArgoManager, APP_CATALOG } from '@vow/orchestrator';
import * as fs from 'node:fs';
import * as path from 'node:path';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const root = getProjectRoot();
    const appDef = APP_CATALOG.find((a) => a.id === id);

    if (!appDef) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }

    const baseArgoPath = path.join(root, 'argo', id, 'argocd.yaml');
    const overrideArgoPath = path.join(root, '.argo_overrides', id, 'argocd.yaml');

    const baseManifest = fs.existsSync(baseArgoPath)
      ? fs.readFileSync(baseArgoPath, 'utf-8')
      : null;

    const overrideManifest = fs.existsSync(overrideArgoPath)
      ? fs.readFileSync(overrideArgoPath, 'utf-8')
      : null;

    const argo = new ArgoManager(root);
    let templatedYaml = '';
    try {
      if (baseManifest) {
        templatedYaml = argo.prepareAppManifest(id).templatedYaml;
      }
    } catch {
      // templating error fallback
    }

    return NextResponse.json({
      app: appDef,
      baseManifest,
      overrideManifest,
      templatedYaml,
      hasOverride: Boolean(overrideManifest),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const root = getProjectRoot();
    const body = await req.json();

    if (body.action === 'deploy') {
      const argo = new ArgoManager(root);
      const task = argo.deployApp(id);
      return NextResponse.json({
        success: true,
        taskId: task.id,
      });
    }

    if (body.action === 'sync') {
      const argo = new ArgoManager(root);
      const task = argo.syncApp(id);
      return NextResponse.json({
        success: true,
        taskId: task.id,
      });
    }

    if (body.action === 'saveOverride') {
      const overrideDir = path.join(root, '.argo_overrides', id);
      if (!fs.existsSync(overrideDir)) {
        fs.mkdirSync(overrideDir, { recursive: true });
      }
      const overrideFile = path.join(overrideDir, 'argocd.yaml');
      fs.writeFileSync(overrideFile, body.overrideYaml, 'utf-8');

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
