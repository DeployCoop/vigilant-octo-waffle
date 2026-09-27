import { NextResponse } from 'next/server';
import { accelerateArgoSync } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { appName, domain } = body;

    const result = await accelerateArgoSync(appName, domain);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Webhook / sync dispatch failed' },
      { status: 500 }
    );
  }
}
