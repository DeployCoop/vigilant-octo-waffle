import { NextResponse } from 'next/server';
import { accelerateArgoSync, authorizeWebhookRequest } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

let warnedUnconfigured = false;

export async function POST(req: Request) {
  // Service-token gate: when VOW_WEBHOOK_TOKEN is configured, this route
  // requires its own credential (Authorization: Bearer <token> or the
  // x-vow-webhook-token header). The middleware defers to this check for
  // this path. When the token is not configured, behavior is unchanged
  // from before, but we warn once so the open posture is visible in logs.
  const auth = authorizeWebhookRequest(req.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.mode === 'unconfigured' && !warnedUnconfigured) {
    warnedUnconfigured = true;
    console.warn(
      '[security] POST /api/argo/webhook has no dedicated credential: set VOW_WEBHOOK_TOKEN to require a service token for this route.'
    );
  }

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
