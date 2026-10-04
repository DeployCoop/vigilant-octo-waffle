import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  decide,
  findPrincipalByToken,
  findPrincipalByOidcSubject,
  getOidcConfig,
  verifyOidcToken,
  looksLikeJwt,
  type AuthzStoreLoad,
  type AuthzTarget,
  type Decision,
  type DecisionReason,
  type Permission,
  type Principal,
} from '@vow/orchestrator';
import { getProjectRoot } from './project';

/**
 * Route-level authorization guards (plan §6.1).
 *
 * Guards live in route handlers, not middleware: Next.js middleware runs
 * in the Edge runtime and cannot read the filesystem grants store.
 * Every guarded route resolves the caller to a principal (store token or
 * OIDC ID token), then asks the orchestrator's central `decide()` — the
 * decision, including its reason, is what gets returned and logged.
 *
 * When authz is not enabled (no store and VOW_AUTHZ unset), `decide()`
 * allows everything and these helpers are effectively no-ops, preserving
 * the local zero-config behavior.
 */

const REASON_MESSAGES: Record<DecisionReason, string> = {
  allow_authz_disabled: 'Authorization is not enabled',
  allow_local_board: 'Local board (bootstrap)',
  allow_role_default: 'Allowed by role',
  allow_explicit_grant: 'Allowed by grant',
  allow_owner: 'Allowed (owner)',
  deny_unauthenticated: 'Authentication required',
  deny_unknown_principal: 'Identity is not provisioned as a principal',
  deny_disabled_principal: 'Principal is disabled',
  deny_missing_grant: 'Missing required permission',
  deny_scope: 'Permission grant does not cover this resource',
  deny_revoked: 'Permission has been revoked for this principal',
  deny_store_invalid: 'Authorization store is invalid',
};

export class AuthzError extends Error {
  status: number;
  reason: DecisionReason;

  constructor(reason: DecisionReason) {
    super(REASON_MESSAGES[reason]);
    this.name = 'AuthzError';
    this.reason = reason;
    this.status = reason === 'deny_unauthenticated' || reason === 'deny_unknown_principal' ? 401 : 403;
  }
}

export interface AuthzContext {
  loaded: AuthzStoreLoad;
  principal: Principal | null;
  unknownPrincipal: boolean;
  localBoard: boolean;
}

/** Tokens are accepted as `Authorization: Bearer <t>` or `x-vow-token: <t>`. */
export function extractRequestToken(req: Request): string | null {
  const custom = req.headers.get('x-vow-token');
  if (custom && custom.trim() !== '') return custom.trim();
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7).trim();
    if (token !== '') return token;
  }
  return null;
}

/**
 * Bootstrap locality check: the request must be addressed to a loopback
 * host with no forwarding headers (i.e. not proxied in from elsewhere).
 */
export function isLocalBoardRequest(req: Request): boolean {
  if (req.headers.get('x-forwarded-for')) return false;
  const host = req.headers.get('host') ?? safeUrlHostname(req.url);
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function safeUrlHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Resolves the request's caller: store token → principal; otherwise, when
 * OIDC is configured and the bearer looks like a JWT, verify it and map
 * the identity (`sub`, falling back to verified email) to a principal.
 * A verified identity with no principal sets `unknownPrincipal`.
 */
export async function resolveAuthzContext(req: Request): Promise<AuthzContext> {
  const loaded = loadAuthzStore(getProjectRoot());
  const localBoard = isLocalBoardRequest(req);
  const base: AuthzContext = { loaded, principal: null, unknownPrincipal: false, localBoard };

  if (loaded.status !== 'ready') return base;

  const token = extractRequestToken(req);
  if (!token) return base;

  const byToken = findPrincipalByToken(loaded.store, token);
  if (byToken) return { ...base, principal: byToken };

  const oidc = getOidcConfig();
  if (oidc && looksLikeJwt(token)) {
    const identity = await verifyOidcToken(token, oidc);
    if (identity) {
      const principal =
        findPrincipalByOidcSubject(loaded.store, identity.subject) ??
        (identity.email ? findPrincipalByOidcSubject(loaded.store, identity.email) : null);
      return { ...base, principal, unknownPrincipal: principal === null };
    }
  }

  return base;
}

/**
 * Authorizes the request for a permission (optionally against a target).
 * Returns the principal and decision on success; throws AuthzError.
 */
export async function requirePermission(
  req: Request,
  permission: Permission,
  target?: AuthzTarget
): Promise<{ principal: Principal | null; decision: Decision }> {
  const ctx = await resolveAuthzContext(req);
  const decision = decide(ctx.loaded, ctx.principal, permission, target, {
    localBoard: ctx.localBoard,
    unknownPrincipal: ctx.unknownPrincipal,
  });
  if (!decision.allowed) throw new AuthzError(decision.reason);
  return { principal: ctx.principal, decision };
}

export function authzErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AuthzError) {
    return NextResponse.json({ error: err.message, reason: err.reason }, { status: err.status });
  }
  return null;
}

/**
 * Guard for routes that already structure their own flow: returns a
 * ready-to-return error response when denied, or null when allowed.
 *
 *   const denied = await authorizeRequest(req, 'k8s:exec', { namespace });
 *   if (denied) return denied;
 */
export async function authorizeRequest(
  req: Request,
  permission: Permission,
  target?: AuthzTarget
): Promise<NextResponse | null> {
  try {
    await requirePermission(req, permission, target);
    return null;
  } catch (err) {
    const response = authzErrorResponse(err);
    if (response) return response;
    throw err;
  }
}

type RouteHandler<Ctx = unknown> = (req: Request, ctx: Ctx) => Promise<Response>;

/**
 * Guard wrapper for single-permission handlers. The authorization check
 * runs before the handler (and therefore before the handler's body
 * parsing). When the permission target depends on the request body, pass
 * `targetFromBody` — the body is read from a clone so the handler can
 * still parse it itself.
 */
export function withAuthz<Ctx = unknown>(
  permission: Permission,
  handler: RouteHandler<Ctx>,
  opts: { targetFromBody?: (body: any) => AuthzTarget | undefined } = {}
): RouteHandler<Ctx> {
  return async (req, ctx) => {
    let target: AuthzTarget | undefined;
    if (opts.targetFromBody) {
      const body = await req
        .clone()
        .json()
        .catch(() => ({}));
      target = opts.targetFromBody(body);
    }
    const denied = await authorizeRequest(req, permission, target);
    if (denied) return denied;
    return handler(req, ctx);
  };
}
