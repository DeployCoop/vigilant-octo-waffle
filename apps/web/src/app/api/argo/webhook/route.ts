import { NextResponse } from 'next/server';
import { accelerateArgoSync, authorizeWebhookRequest, decide } from '@vow/orchestrator';
import { resolveAuthzContext, recordAudit } from '@/lib/authz';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

let warnedUnconfigured = false;

export async function POST(req: Request) {
  // Two credential paths:
  //
  // 1. Authz store service principal — when the store is active and the
  //    presented token resolves to a principal, that principal must hold
  //    the `webhook:argo` grant. A resolved principal without the grant is
  //    rejected outright (it identified itself; no fallthrough).
  // 2. The dedicated env service token from PR 0 (`VOW_WEBHOOK_TOKEN`),
  //    used when no store principal resolves (or no store exists).
  const ctx = await resolveAuthzContext(req);
  if (ctx.loaded.status === 'invalid') {
    return apiError(403, 'Authorization store is invalid', {
      reason: 'deny_store_invalid',
    });
  }
  if (ctx.loaded.status === 'ready' && ctx.principal) {
    const decision = decide(ctx.loaded, ctx.principal, 'webhook:argo', undefined, {
      localBoard: ctx.localBoard,
      unknownPrincipal: ctx.unknownPrincipal,
    });
    recordAudit(req, 'webhook:argo', decision);
    if (!decision.allowed) {
      return apiError(403, 'Principal lacks the webhook:argo permission', {
        reason: decision.reason,
      });
    }
  } else {
    // Service-token gate: when VOW_WEBHOOK_TOKEN is configured, this route
    // requires its own credential (Authorization: Bearer <token> or the
    // x-vow-webhook-token header). The middleware defers to this check for
    // this path. When the token is not configured, behavior is unchanged
    // from before, but we warn once so the open posture is visible in logs.
    const auth = authorizeWebhookRequest(req.headers);
    if (!auth.authorized) {
      recordAudit(req, 'webhook:argo', { allowed: false, reason: 'deny_unauthenticated' });
      return apiError(auth.status, auth.error ?? 'Unauthorized');
    }
    if (auth.mode === 'unconfigured' && !warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        '[security] POST /api/argo/webhook has no dedicated credential: set VOW_WEBHOOK_TOKEN to require a service token for this route.'
      );
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { appName, domain } = body;

    const result = await accelerateArgoSync(appName, domain);
    return NextResponse.json(result);
  } catch (err) {
    return routeError(err, {
      route: 'POST /api/argo/webhook',
      fallbackMessage: 'Webhook / sync dispatch failed',
    });
  }
}
