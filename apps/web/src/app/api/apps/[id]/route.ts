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
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid application ID format' }, { status: 400 });
    }

    const root = getProjectRoot();
    const appDef = APP_CATALOG.find((a) => a.id === id);

    if (!appDef) {
      return NextResponse.json({ error: 'App not found in catalog' }, { status: 404 });
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
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid application ID format' }, { status: 400 });
    }

    const root = getProjectRoot();
    const appDef = APP_CATALOG.find((a) => a.id === id);

    if (!appDef) {
      return NextResponse.json({ error: 'App not found in catalog' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));

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
      if (typeof body.overrideYaml !== 'string') {
        return NextResponse.json({ error: 'overrideYaml string is required' }, { status: 400 });
      }

      const overridesBase = path.resolve(root, '.argo_overrides');
      const overrideDir = path.resolve(overridesBase, id);

      // Path traversal containment check
      if (!overrideDir.startsWith(overridesBase + path.sep)) {
        return NextResponse.json({ error: 'Invalid override destination path' }, { status: 400 });
      }

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
