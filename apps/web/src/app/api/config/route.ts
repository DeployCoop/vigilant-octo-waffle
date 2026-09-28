import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import { loadProjectConfig, saveEnvFile } from '@vow/orchestrator';

export async function GET() {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);

    return NextResponse.json({
      config: config.raw,
      cluster: config.cluster,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const { updates } = await req.json();

    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Invalid updates' }, { status: 400 });
    }

    const currentConfig = loadProjectConfig(root);
    const newRaw = { ...currentConfig.raw, ...updates };

    saveEnvFile(root, newRaw);

    return NextResponse.json({
      success: true,
      updated: Object.keys(updates).length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
