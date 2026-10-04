import { NextResponse } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  loadAuthzStore,
  decide,
  findPrincipalByToken,
  findPrincipalByOidcSubject,
  getOidcConfig,
  verifyOidcToken,
  looksLikeJwt,
  webhookTokensEqual,
  type AuthzStoreLoad,
  type AuthzTarget,
  type Decision,
  type DecisionReason,
  type Permission,
  type Principal,
} from '@vow/orchestrator';
import { getProjectRoot } from './project';
import { errorBody } from './envelope';

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

/** Synthetic principal for the legacy VOW_API_TOKEN bootstrap credential. */
export const BOOTSTRAP_OWNER_PRINCIPAL: Principal = {
  id: 'bootstrap-owner',
  name: 'Bootstrap owner (VOW_API_TOKEN)',
  kind: 'service',
  role: 'owner',
};

let warnedBootstrapToken = false;

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

  // Bootstrap owner: the legacy shared VOW_API_TOKEN acts as an
  // owner-equivalent credential (plan §7) so existing deployments keep a
  // way in. Using it logs a one-time deprecation warning.
  const legacyToken = process.env.VOW_API_TOKEN;
  if (legacyToken && webhookTokensEqual(token, legacyToken)) {
    if (!warnedBootstrapToken) {
      warnedBootstrapToken = true;
      console.warn(
        '[authz] VOW_API_TOKEN was used as a bootstrap owner credential. Migrate to a store principal (`vow authz add`) and unset VOW_API_TOKEN.'
      );
    }
    return { ...base, principal: BOOTSTRAP_OWNER_PRINCIPAL };
  }

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

// ---------------------------------------------------------------------------
// Audit logging (plan §10): every decision for a mutating permission, and
// every denial, is appended as one JSON line to <projectRoot>/.vow/audit.log.
// ---------------------------------------------------------------------------

export interface AuditEntry {
  ts: string;
  principalId: string | null;
  permission: Permission;
  target?: AuthzTarget;
  allowed: boolean;
  reason: DecisionReason;
  route: string;
}

const READ_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'apps:read',
  'cluster:read',
  'config:read',
  'k8s:read',
  'k8s:logs:read',
  'tasks:read',
  'security:read',
  'secrets:read',
]);

export function auditLogPath(root: string): string {
  return path.join(root, '.vow', 'audit.log');
}

export function formatAuditEntry(entry: AuditEntry): string {
  return JSON.stringify(entry);
}

function shouldAudit(permission: Permission, decision: Decision): boolean {
  if (decision.reason === 'allow_authz_disabled') return false;
  return !decision.allowed || !READ_PERMISSIONS.has(permission);
}

/** Appends one audit entry. Never throws — audit must not break requests. */
export function recordAudit(
  req: Request,
  permission: Permission,
  decision: Decision,
  target?: AuthzTarget
): void {
  try {
    const file = auditLogPath(getProjectRoot());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let route = '';
    try {
      route = new URL(req.url).pathname;
    } catch {
      route = '';
    }
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      principalId: decision.principalId ?? null,
      permission,
      ...(target ? { target } : {}),
      allowed: decision.allowed,
      reason: decision.reason,
      route,
    };
    fs.appendFileSync(file, formatAuditEntry(entry) + '\n');
  } catch (err) {
    console.error('[authz] failed to write audit entry:', err);
  }
}

/** Reads the most recent audit entries (newest first). */
export function readAuditEntries(root: string, limit = 200): AuditEntry[] {
  try {
    const lines = fs.readFileSync(auditLogPath(root), 'utf-8').split('\n').filter(Boolean);
    const entries: AuditEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip torn/corrupt lines rather than failing the whole read.
      }
    }
    return entries.reverse();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Permission checks
// ---------------------------------------------------------------------------

export interface PermissionCheck {
  allowed: boolean;
  status: number;
  reason: DecisionReason;
  decision: Decision;
  ctx: AuthzContext;
}

/**
 * Resolves the caller and runs the central `decide()` for a permission,
 * recording the decision to the audit log when required. Does not throw
 * on denial — see requirePermission/authorizeRequest for guard styles.
 */
export async function checkPermission(
  req: Request,
  permission: Permission,
  target?: AuthzTarget
): Promise<PermissionCheck> {
  const ctx = await resolveAuthzContext(req);
  const decision = decide(ctx.loaded, ctx.principal, permission, target, {
    localBoard: ctx.localBoard,
    unknownPrincipal: ctx.unknownPrincipal,
  });
  if (shouldAudit(permission, decision)) {
    recordAudit(req, permission, decision, target);
  }
  return {
    allowed: decision.allowed,
    status: decision.allowed ? 200 : new AuthzError(decision.reason).status,
    reason: decision.reason,
    decision,
    ctx,
  };
}

/** Non-throwing boolean check, for secondary decisions like redaction. */
export async function callerCan(
  req: Request,
  permission: Permission,
  target?: AuthzTarget
): Promise<boolean> {
  const check = await checkPermission(req, permission, target);
  return check.allowed;
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
  const check = await checkPermission(req, permission, target);
  if (!check.allowed) throw new AuthzError(check.reason);
  return { principal: check.ctx.principal, decision: check.decision };
}

export function authzErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AuthzError) {
    // WS4 envelope: the deny shape { error: string, reason } is
    // absorbed into { error: { code, message, reason } }.
    return NextResponse.json(
      errorBody(
        err.status === 401 ? 'unauthenticated' : 'forbidden',
        err.message,
        err.reason
      ),
      { status: err.status }
    );
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
  const check = await checkPermission(req, permission, target);
  if (check.allowed) return null;
  return authzErrorResponse(new AuthzError(check.reason));
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

// ---------------------------------------------------------------------------
// Admin API support (plan §6.3)
// ---------------------------------------------------------------------------

/** A principal as exposed to admin clients — token hashes never leave the server. */
export interface PublicPrincipal {
  id: string;
  name: string;
  kind: Principal['kind'];
  role: Principal['role'];
  oidcSubject?: string;
  disabled: boolean;
  grants: NonNullable<Principal['grants']>;
  revocations: NonNullable<Principal['revocations']>;
  hasToken: boolean;
}

export function toPublicPrincipal(principal: Principal): PublicPrincipal {
  return {
    id: principal.id,
    name: principal.name,
    kind: principal.kind,
    role: principal.role,
    ...(principal.oidcSubject ? { oidcSubject: principal.oidcSubject } : {}),
    disabled: principal.disabled ?? false,
    grants: principal.grants ?? [],
    revocations: principal.revocations ?? [],
    hasToken: Boolean(principal.tokenHash),
  };
}

function slugifyPrincipalName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'principal';
}

/** Mirrors the CLI's id scheme: `p_<slug>`, with a random suffix on collision. */
export function uniquePrincipalId(
  store: { principals: Array<{ id: string }> },
  name: string
): string {
  const base = `p_${slugifyPrincipalName(name)}`;
  if (!store.principals.some((p) => p.id === base)) return base;
  return `${base}_${randomBytes(2).toString('hex')}`;
}
