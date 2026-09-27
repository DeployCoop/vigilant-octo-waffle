import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProjectRoot } from '@/lib/project';
import { ArgoManager, loadProjectConfig } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const root = getProjectRoot();
    const { searchParams } = new URL(req.url);
    const app = searchParams.get('app');

    if (!app) {
      return NextResponse.json({ error: 'App parameter required' }, { status: 400 });
    }

    const argoManager = new ArgoManager(root);
    const basePath = path.join(root, 'argo', app, 'argocd.yaml');
    const overridePath = path.join(root, '.argo_overrides', app, 'argocd.yaml');

    if (!fs.existsSync(basePath)) {
      return NextResponse.json({ error: `Manifest not found for ${app}` }, { status: 404 });
    }

    const baseYaml = fs.readFileSync(basePath, 'utf-8');
    const hasOverride = fs.existsSync(overridePath);
    const overrideYaml = hasOverride ? fs.readFileSync(overridePath, 'utf-8') : '';

    let prepared;
    try {
      prepared = argoManager.prepareAppManifest(app);
    } catch {
      prepared = { templatedYaml: baseYaml };
    }

    return NextResponse.json({
      app,
      hasOverride,
      baseYaml,
      overrideYaml,
      templatedYaml: prepared.templatedYaml,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json();
    const { app, overrideYaml } = body;

    if (!app || typeof overrideYaml !== 'string') {
      return NextResponse.json({ error: 'app and overrideYaml required' }, { status: 400 });
    }

    const overrideDir = path.join(root, '.argo_overrides', app);
    const overridePath = path.join(overrideDir, 'argocd.yaml');

    if (overrideYaml.trim() === '') {
      // If empty, delete override
      if (fs.existsSync(overridePath)) {
        fs.unlinkSync(overridePath);
      }
    } else {
      if (!fs.existsSync(overrideDir)) {
        fs.mkdirSync(overrideDir, { recursive: true });
      }
      fs.writeFileSync(overridePath, overrideYaml, 'utf-8');
    }

    return NextResponse.json({ success: true, app });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
