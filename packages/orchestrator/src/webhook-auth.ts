import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Service-token authentication for the ArgoCD webhook accelerator route
 * (POST /api/argo/webhook).
 *
 * The webhook route performs a privileged action (it annotates ArgoCD
 * Application CRDs and dispatches synthetic Git push webhooks), so it gets
 * its own least-privilege credential instead of relying on the shared
 * control-plane token:
 *
 * - Set `VOW_WEBHOOK_TOKEN` in the environment to enable enforcement.
 * - Callers present it as `Authorization: Bearer <token>` or the
 *   `x-vow-webhook-token` header.
 * - When the variable is unset and no authz store is active, the route
 *   keeps its previous behavior (no dedicated credential) and the caller
 *   is told via the result mode so the route can log a warning. When an
 *   authz store IS active, an unset token denies instead: the route
 *   must not stay open behind an enabled authorization system.
 *
 * This module is the seam where the future authz service-principal store
 * (see authz_implementation.md, permission `webhook:argo`) will plug in:
 * the route only depends on `authorizeWebhookRequest`.
 */

export const WEBHOOK_TOKEN_ENV = 'VOW_WEBHOOK_TOKEN';
export const WEBHOOK_TOKEN_HEADER = 'x-vow-webhook-token';

export type WebhookAuthResult =
  | { authorized: true; mode: 'token' | 'unconfigured' }
  | { authorized: false; status: 401; error: string };

/** Returns the configured webhook token, treating empty/blank as unset. */
export function getConfiguredWebhookToken(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const token = env[WEBHOOK_TOKEN_ENV];
  if (!token || token.trim() === '') return undefined;
  return token;
}

/**
 * Extracts the presented webhook token from request headers.
 * Accepts `Authorization: Bearer <token>` or `x-vow-webhook-token`.
 * Returns null when no credential was presented.
 */
export function extractWebhookToken(headers: Headers): string | null {
  const custom = headers.get(WEBHOOK_TOKEN_HEADER);
  if (custom && custom.trim() !== '') return custom.trim();

  const auth = headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7).trim();
    if (token !== '') return token;
  }

  return null;
}

/**
 * Constant-time token comparison. Both sides are hashed first so the
 * comparison never leaks the expected token's length or prefix.
 */
export function webhookTokensEqual(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

/**
 * Authorizes a webhook request against the configured service token.
 *
 * - Token configured + matching credential  → { authorized: true, mode: 'token' }
 * - Token configured + missing/wrong         → { authorized: false, status: 401 }
 * - Token not configured + store inactive    → { authorized: true, mode: 'unconfigured' }
 *   (the pre-authz zero-config behavior; the route logs a warning)
 * - Token not configured + store ACTIVE      → { authorized: false, status: 401 }
 *   (BUG FIX: an operator who enabled authorization reasonably expects
 *   unauthenticated callers to be rejected; leaving the webhook open
 *   until a *separate* env token is set defeats that expectation)
 */
export function authorizeWebhookRequest(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env,
  storeActive = false
): WebhookAuthResult {
  const expected = getConfiguredWebhookToken(env);
  if (!expected) {
    if (storeActive) {
      return {
        authorized: false,
        status: 401,
        error:
          'Unauthorized: authorization is enabled but no webhook token is configured (set VOW_WEBHOOK_TOKEN or call with a principal holding webhook:argo)',
      };
    }
    return { authorized: true, mode: 'unconfigured' };
  }

  const provided = extractWebhookToken(headers);
  if (provided && webhookTokensEqual(provided, expected)) {
    return { authorized: true, mode: 'token' };
  }

  return {
    authorized: false,
    status: 401,
    error: 'Unauthorized: Missing or invalid webhook token',
  };
}
