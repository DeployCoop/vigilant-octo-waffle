import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

/**
 * Authorization engine (see authz_implementation.md).
 *
 * A Paperclip-style authorization model evaluated with CASL:
 *
 * - Every API caller resolves to a *principal* (human or service).
 * - Principals have a *role* — a bundle of default permission keys — plus
 *   explicit *grants* that may be scoped to an app and/or namespace, and
 *   optional *revocations* that subtract keys.
 * - `decide()` is the single decision point. It walks the layers in order
 *   and returns an explainable reason (Paperclip's decision reasons), while
 *   CASL (`buildAbility`) is the rule evaluator underneath and the format
 *   the dashboard will reuse for UI gating.
 * - The store is a hand-editable YAML file at `<projectRoot>/.vow/authz.yaml`,
 *   validated with zod on every load. When authorization is enabled, any
 *   store problem fails closed (`deny_store_invalid`).
 *
 * This module is pure apart from the store loader/saver; nothing here
 * changes runtime behavior until route guards opt in (PR 2+).
 */

// ---------------------------------------------------------------------------
// Permission catalog (plan §4.2) — single source of truth.
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  'apps:read',
  'apps:deploy',
  'apps:override',
  'argo:sync',
  'flux:sync',
  'flux:bootstrap',
  'webhook:argo',
  'cluster:read',
  'cluster:manage',
  'cluster:nodes:join',
  'config:read',
  'config:update',
  'k8s:read',
  'k8s:logs:read',
  'k8s:exec',
  'tasks:read',
  'tasks:run',
  'data:query',
  'remote:exec',
  'secrets:read',
  'security:read',
  'backups:manage',
  'chaos:run',
  'dns:update',
  'export:run',
  'helm:manage',
  'namespaces:manage',
  'network:manage',
  'rollouts:manage',
  'storage:manage',
  'builder:run',
  'ai:diagnose',
  'system:manage',
  'users:manage_permissions',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Roles (plan §4.3) — default permission bundles.
// ---------------------------------------------------------------------------

export const ROLES = ['owner', 'admin', 'operator', 'viewer', 'webhook'] as const;

export type Role = (typeof ROLES)[number];

const OPERATOR_PERMISSIONS: readonly Permission[] = [
  'apps:read',
  'apps:deploy',
  'argo:sync',
  'flux:sync',
  'cluster:read',
  'config:read',
  'k8s:read',
  'k8s:logs:read',
  'tasks:read',
  'tasks:run',
  'namespaces:manage',
  'rollouts:manage',
  'helm:manage',
  'backups:manage',
  'security:read',
];

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'apps:read',
  'cluster:read',
  'config:read',
  'k8s:read',
  'tasks:read',
  'security:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'users:manage_permissions'),
  operator: OPERATOR_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
  webhook: [],
};

export function rolePermissions(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

// ---------------------------------------------------------------------------
// Data model (plan §4.1, §4.4)
// ---------------------------------------------------------------------------

/** A grant scope. All present fields must match the target (AND). */
export interface GrantScope {
  appId?: string;
  namespace?: string;
}

export interface Grant {
  permission: Permission;
  scope?: GrantScope;
  context?: GrantContext;
}

/**
 * Request-context conditions on a grant (Plan II WS5 §8.1). All present
 * fields must match the request context (AND). Evaluated by `decide()` —
 * CASL conditions bind to the target only, so request facts (time, source,
 * sign-in method) are threaded through `DecideOptions.requestContext`.
 */
export interface GrantContext {
  /** ISO timestamp: the grant counts only at or after this instant. */
  notBefore?: string;
  /** ISO timestamp: the grant counts only before this instant. */
  notAfter?: string;
  /** The request must originate from a loopback host. */
  source?: 'loopback' | 'any';
  /** How the caller must have authenticated for this grant to count. */
  authMethod?: 'session' | 'token' | 'oidc' | 'any';
}

/** How a caller authenticated, as seen by the decision point. */
export type AuthMethod = 'session' | 'token' | 'oidc';

/** The request facts context-scoped grants are evaluated against. */
export interface RequestContext {
  now: Date;
  loopback: boolean;
  authMethod: AuthMethod;
}

export interface Principal {
  id: string;
  name: string;
  kind: 'human' | 'service';
  role: Role;
  /** `sha256:<hex>` of the principal's token. Tokens are never stored raw. */
  tokenHash?: string;
  /** OIDC `sub` (or verified email) this principal maps from (plan §6.4). */
  oidcSubject?: string;
  disabled?: boolean;
  grants?: Grant[];
  revocations?: Permission[];
}

export interface AuthzStore {
  version: 1;
  principals: Principal[];
  sessions?: AuthzSession[];
}

/**
 * A browser session record (Plan II WS5 §8.2). Only the sha256 hash of the
 * session id is stored; the id itself lives solely in the client's
 * httpOnly cookie. Expiry is absolute from `createdAt` (no sliding
 * renewal, so resolving a session never writes the store).
 */
export interface AuthzSession {
  idHash: string;
  principalId: string;
  createdAt: string;
  expiresAt: string;
}

/** The resource context a permission check runs against. */
export interface AuthzTarget {
  appId?: string;
  namespace?: string;
}

export function createEmptyStore(): AuthzStore {
  return { version: 1, principals: [] };
}

// ---------------------------------------------------------------------------
// Store schema, parsing, persistence
// ---------------------------------------------------------------------------

const permissionSchema = z.enum([...PERMISSIONS] as [Permission, ...Permission[]]);
const roleSchema = z.enum([...ROLES] as [Role, ...Role[]]);

const grantScopeSchema = z.object({
  appId: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
});

const grantContextSchema = z.object({
  notBefore: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'notBefore must be an ISO timestamp' })
    .optional(),
  notAfter: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'notAfter must be an ISO timestamp' })
    .optional(),
  source: z.enum(['loopback', 'any']).optional(),
  authMethod: z.enum(['session', 'token', 'oidc', 'any']).optional(),
});

const grantSchema = z.object({
  permission: permissionSchema,
  scope: grantScopeSchema.optional(),
  context: grantContextSchema.optional(),
});

/**
 * Validates a grant-context value (e.g. parsed from CLI JSON) against
 * `grantContextSchema` — the same schema the store enforces — so accepted
 * values can never drift between surfaces. Returns an error message or
 * null. The messages keep the phrasing the authz CLI has always printed.
 */
export function validateGrantContext(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'must be a JSON object';
  }
  const shape = grantContextSchema.shape;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(shape, key)) {
      return `unknown field: ${key}`;
    }
    const field = shape[key as keyof typeof shape];
    if (field.safeParse(v).success) continue;
    switch (key) {
      case 'notBefore':
      case 'notAfter':
        return `${key} must be an ISO timestamp`;
      case 'source':
        return 'source must be "loopback" or "any"';
      case 'authMethod':
        return 'authMethod must be "session", "token", "oidc", or "any"';
      default:
        return `invalid value for field: ${key}`;
    }
  }
  return null;
}

const sessionSchema = z.object({
  idHash: z.string().min(1),
  principalId: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
});

const principalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['human', 'service']),
  role: roleSchema,
  tokenHash: z.string().min(1).optional(),
  oidcSubject: z.string().min(1).optional(),
  disabled: z.boolean().optional(),
  grants: z.array(grantSchema).optional(),
  revocations: z.array(permissionSchema).optional(),
});

const authzStoreSchema = z
  .object({
    version: z.literal(1),
    principals: z.array(principalSchema),
    sessions: z.array(sessionSchema).optional(),
  })
  .superRefine((store, ctx) => {
    const seen = new Set<string>();
    for (const principal of store.principals) {
      if (seen.has(principal.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate principal id: ${principal.id}`,
        });
      }
      seen.add(principal.id);
    }
  });

/** Parses and validates YAML store text. Throws on any problem (fail closed). */
export function parseAuthzStore(text: string): AuthzStore {
  const doc = parseYaml(text) as unknown;
  return authzStoreSchema.parse(doc) as AuthzStore;
}

/** Serializes a store to its YAML file form. Validates before writing. */
export function serializeAuthzStore(store: AuthzStore): string {
  const valid = authzStoreSchema.parse(store) as AuthzStore;
  return stringifyYaml(valid, { indent: 2 });
}

export const AUTHZ_DIR_NAME = '.vow';
export const AUTHZ_STORE_FILENAME = 'authz.yaml';
export const AUTHZ_ENV_FLAG = 'VOW_AUTHZ';

export function authzStorePath(projectRoot: string): string {
  return path.join(projectRoot, AUTHZ_DIR_NAME, AUTHZ_STORE_FILENAME);
}

export type AuthzStoreLoad =
  | { status: 'disabled' }
  | { status: 'ready'; store: AuthzStore }
  | { status: 'invalid'; error: string };

interface StoreCacheEntry {
  mtimeMs: number | null;
  load: AuthzStoreLoad;
}

const storeCache = new Map<string, StoreCacheEntry>();

export function clearAuthzStoreCache(): void {
  storeCache.clear();
}

/**
 * Loads the authorization store for a project.
 *
 * Authz is enabled when the store file exists or `VOW_AUTHZ=on`; otherwise
 * the result is `disabled` and callers keep today's behavior. A present but
 * unreadable/invalid store yields `invalid`, which `decide()` fails closed.
 * Results are cached per path and invalidated by file mtime.
 */
export function loadAuthzStore(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env
): AuthzStoreLoad {
  const file = authzStorePath(projectRoot);

  let mtimeMs: number | null;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    mtimeMs = null;
  }

  const cached = storeCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.load;

  let load: AuthzStoreLoad;
  if (mtimeMs === null) {
    load =
      env[AUTHZ_ENV_FLAG] === 'on'
        ? { status: 'ready', store: createEmptyStore() }
        : { status: 'disabled' };
  } else {
    try {
      const store = parseAuthzStore(fs.readFileSync(file, 'utf-8'));
      load = { status: 'ready', store };
    } catch (err: any) {
      load = { status: 'invalid', error: err?.message ?? String(err) };
    }
  }

  storeCache.set(file, { mtimeMs, load });
  return load;
}

/** Writes the store to disk (mode 0600) and refreshes the load cache. */
export function saveAuthzStore(projectRoot: string, store: AuthzStore): void {
  const file = authzStorePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeAuthzStore(store), { mode: 0o600 });
  // writeFileSync's mode only applies on creation; enforce on rewrites too.
  fs.chmodSync(file, 0o600);
  storeCache.delete(file);
}

/**
 * Returns true when authorization is active (either store exists or VOW_AUTHZ=on).
 */
export function isAuthzEnabled(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const load = loadAuthzStore(projectRoot, env);
  return load.status === 'ready' || load.status === 'invalid';
}

// ---------------------------------------------------------------------------
// CASL ability construction
// ---------------------------------------------------------------------------

export type AuthzAction = Permission | 'manage';
// Subjects are the string tags ('AuthzTarget', 'all') or tagged target
// objects. CASL's own generics are happiest with this widened form; the
// runtime rules are verified by the decide()/ability consistency tests.
export type AuthzAbility = MongoAbility<[AuthzAction, string | Record<string, unknown>]>;

export const AUTHZ_SUBJECT_TYPE = 'AuthzTarget';

/** Tags a target object so CASL can match it against AuthzTarget rules. */
export function authzSubject(target?: AuthzTarget): Record<string, unknown> {
  return { ...(target ?? {}), __caslSubjectType__: AUTHZ_SUBJECT_TYPE };
}

function scopeIsEmpty(scope?: GrantScope): boolean {
  return !scope || (scope.appId === undefined && scope.namespace === undefined);
}

/**
 * Builds the CASL ability for a principal: role defaults first, then
 * explicit grants (scoped grants become CASL conditions), then revocations.
 * NOTE: grant *context* conditions (§8.1) are enforced by `decide()` only —
 * CASL conditions bind to the target, not the request — so these rules are
 * the UI's approximation; the API's `decide()` stays authoritative.
 * as `cannot` rules (last rules win in CASL, so revocations subtract from
 * both role defaults and grants). A disabled or unknown principal gets an
 * empty ability. The owner role gets CASL's `manage all` wildcard.
 */
export function buildAbility(principal: Principal | null): AuthzAbility {
  const { can, cannot, build } = new AbilityBuilder<AuthzAbility>(createMongoAbility);

  if (!principal || principal.disabled) return build();

  if (principal.role === 'owner') {
    can('manage', 'all');
  } else {
    for (const permission of rolePermissions(principal.role)) {
      can(permission, AUTHZ_SUBJECT_TYPE);
    }
  }

  for (const grant of principal.grants ?? []) {
    if (scopeIsEmpty(grant.scope)) {
      can(grant.permission, AUTHZ_SUBJECT_TYPE);
    } else {
      can(grant.permission, AUTHZ_SUBJECT_TYPE, { ...grant.scope });
    }
  }

  for (const revoked of principal.revocations ?? []) {
    cannot(revoked, AUTHZ_SUBJECT_TYPE);
  }

  return build();
}

/** True when the principal's CASL ability permits the action on the target. */
export function abilityAllows(
  principal: Principal | null,
  permission: Permission,
  target?: AuthzTarget
): boolean {
  return buildAbility(principal).can(permission, authzSubject(target));
}

/** Evaluates one grant's scope against a target using CASL conditions. */
function grantCoversTarget(grant: Grant, target?: AuthzTarget): boolean {
  if (scopeIsEmpty(grant.scope)) return true;
  if (!target) return false;
  const { can, build } = new AbilityBuilder<AuthzAbility>(createMongoAbility);
  can(grant.permission, AUTHZ_SUBJECT_TYPE, { ...grant.scope });
  return build().can(grant.permission, authzSubject(target));
}

// ---------------------------------------------------------------------------
// The decision point (plan §5)
// ---------------------------------------------------------------------------

export type DecisionReason =
  | 'allow_authz_disabled'
  | 'allow_local_board'
  | 'allow_role_default'
  | 'allow_explicit_grant'
  | 'allow_owner'
  | 'deny_unauthenticated'
  | 'deny_unknown_principal'
  | 'deny_disabled_principal'
  | 'deny_missing_grant'
  | 'deny_scope'
  | 'deny_context'
  | 'deny_revoked'
  | 'deny_store_invalid';

export interface Decision {
  allowed: boolean;
  reason: DecisionReason;
  principalId?: string;
}

/**
 * True when a grant's context conditions match the request context.
 * A grant without context always matches. A context-carrying grant with
 * NO request context supplied fails closed — honoring it requires a
 * caller that knows the request facts (the web layer always supplies
 * them; see `DecideOptions.requestContext`).
 */
export function grantContextMatches(
  context: GrantContext | undefined,
  requestContext?: RequestContext
): boolean {
  if (!context) return true;
  if (!requestContext) return false;
  const now = requestContext.now.getTime();
  if (context.notBefore !== undefined && now < Date.parse(context.notBefore)) return false;
  if (context.notAfter !== undefined && now >= Date.parse(context.notAfter)) return false;
  if (context.source === 'loopback' && !requestContext.loopback) return false;
  if (
    context.authMethod !== undefined &&
    context.authMethod !== 'any' &&
    context.authMethod !== requestContext.authMethod
  ) {
    return false;
  }
  return true;
}

export interface DecideOptions {
  /**
   * True when the request is a local (loopback) board request. Bootstrap
   * mode (`allow_local_board`) applies only while the store has zero
   * principals, so an operator can never lock themselves out before
   * creating the first principal.
   */
  localBoard?: boolean;
  /**
   * True when the caller presented a valid identity (e.g. a verified OIDC
   * token) that maps to no principal. Such callers get
   * `deny_unknown_principal` instead of `deny_unauthenticated`.
   */
  unknownPrincipal?: boolean;
  /**
   * The request facts context-scoped grants are evaluated against
   * (WS5 §8.1). Callers that authorize real requests must supply this;
   * omitting it makes context-carrying grants unsatisfiable (fail
   * closed) while leaving context-free behavior unchanged.
   */
  requestContext?: RequestContext;
}

function deny(reason: DecisionReason, principal?: Principal | null): Decision {
  return { allowed: false, reason, principalId: principal?.id };
}

function allow(reason: DecisionReason, principal?: Principal | null): Decision {
  return { allowed: true, reason, principalId: principal?.id };
}

/**
 * The single authorization decision point. Walks the layers in a fixed
 * order so the returned reason explains exactly which layer decided:
 * store state → bootstrap → authentication → disabled → revocations →
 * owner → role defaults → explicit grants (with CASL scope matching).
 */
export function decide(
  loaded: AuthzStoreLoad,
  principal: Principal | null,
  permission: Permission,
  target?: AuthzTarget,
  opts: DecideOptions = {}
): Decision {
  if (loaded.status === 'disabled') return allow('allow_authz_disabled', principal);
  if (loaded.status === 'invalid') return deny('deny_store_invalid', principal);

  const { store } = loaded;

  if (store.principals.length === 0 && opts.localBoard) {
    return allow('allow_local_board', principal);
  }

  if (!principal) {
    return deny(opts.unknownPrincipal ? 'deny_unknown_principal' : 'deny_unauthenticated');
  }

  if (principal.disabled) return deny('deny_disabled_principal', principal);

  if ((principal.revocations ?? []).includes(permission)) {
    return deny('deny_revoked', principal);
  }

  if (principal.role === 'owner') return allow('allow_owner', principal);

  if (rolePermissions(principal.role).includes(permission)) {
    return allow('allow_role_default', principal);
  }

  const grants = (principal.grants ?? []).filter((g) => g.permission === permission);
  if (grants.length > 0) {
    const covering = grants.filter((g) => grantCoversTarget(g, target));
    if (covering.some((g) => grantContextMatches(g.context, opts.requestContext))) {
      return allow('allow_explicit_grant', principal);
    }
    // A grant covers the target but its context rejects this request —
    // reported distinctly so the audit trail shows *why*.
    if (covering.length > 0) return deny('deny_context', principal);
    return deny('deny_scope', principal);
  }

  return deny('deny_missing_grant', principal);
}

// ---------------------------------------------------------------------------
// Principal tokens
// ---------------------------------------------------------------------------

export const TOKEN_PREFIX = 'vow_';
export const TOKEN_HASH_PREFIX = 'sha256:';

/** Generates a new principal token. Shown once at creation; never stored. */
export function generatePrincipalToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** Hashes a token for storage (`sha256:<hex>`). */
/**
 * Minimum length for a human-chosen password (Plan II §4.4, §16 Q5: 12).
 * Applies at the bootstrap entry points only (web init route, authz CLI
 * init); generated principal tokens are far longer by construction.
 */
export const MIN_PASSWORD_LENGTH = 12;

export function hashToken(token: string): string {
  return TOKEN_HASH_PREFIX + createHash('sha256').update(token).digest('hex');
}

export const PASSWORD_HASH_PREFIX = 'scrypt:';
const SCRYPT_KEYLEN = 32;

/**
 * Hashes a human-chosen password for storage (`scrypt:<saltHex>:<hashHex>`).
 * Passwords are low-entropy, so they get a memory-hard KDF; generated
 * principal tokens are 256-bit random and keep the fast sha256 scheme
 * (see hashToken). verifyTokenHash dispatches on the stored prefix, so
 * existing sha256-stored credentials keep verifying.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return PASSWORD_HASH_PREFIX + salt.toString('hex') + ':' + derived.toString('hex');
}

function verifyPasswordHash(password: string, stored: string): boolean {
  const parts = stored.slice(PASSWORD_HASH_PREFIX.length).split(':');
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], 'hex');
  const expected = Buffer.from(parts[1], 'hex');
  if (salt.length === 0 || expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(expected, actual);
}

/** Constant-time check of a presented token against a stored hash. */
export function verifyTokenHash(token: string, tokenHash: string): boolean {
  if (tokenHash.startsWith(PASSWORD_HASH_PREFIX)) return verifyPasswordHash(token, tokenHash);
  if (!tokenHash.startsWith(TOKEN_HASH_PREFIX)) return false;
  const expected = Buffer.from(tokenHash.slice(TOKEN_HASH_PREFIX.length), 'hex');
  const actual = createHash('sha256').update(token).digest();
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Resolves a presented token to its principal, or null. Compares against
 * every principal's hash (no early exit) so response timing does not leak
 * which position in the store matched.
 */
export function findPrincipalByToken(store: AuthzStore, token: string): Principal | null {
  let match: Principal | null = null;
  for (const principal of store.principals) {
    if (principal.tokenHash && verifyTokenHash(token, principal.tokenHash)) {
      match = principal;
    }
  }
  return match;
}

/** Resolves a verified OIDC identity (`sub` or email) to its principal. */
export function findPrincipalByOidcSubject(
  store: AuthzStore,
  oidcSubject: string
): Principal | null {
  return store.principals.find((p) => p.oidcSubject === oidcSubject) ?? null;
}

// ---------------------------------------------------------------------------
// Browser sessions (Plan II WS5 §8.2)
// ---------------------------------------------------------------------------

/** Session lifetime: 12 hours, absolute (Plan II WS5 design D2). */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Cookie carrying the session id (set httpOnly by the web layer). */
export const SESSION_COOKIE_NAME = 'vow_session';

/** Bounds store growth: oldest sessions are evicted past this per principal. */
export const MAX_SESSIONS_PER_PRINCIPAL = 10;

/** Mints a new session id. Shown once (as a cookie); only its hash is stored. */
export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** Returns the store with its session list replaced (field omitted when empty). */
function withSessions(store: AuthzStore, sessions: AuthzSession[]): AuthzStore {
  const next: AuthzStore = { version: store.version, principals: store.principals };
  if (sessions.length > 0) next.sessions = sessions;
  return next;
}

/** Sessions whose expiry has passed, dropped. Pure; `now` injectable for tests. */
export function pruneExpiredSessions(store: AuthzStore, now: Date = new Date()): AuthzStore {
  if (!store.sessions || store.sessions.length === 0) return store;
  const kept = store.sessions.filter((sess) => Date.parse(sess.expiresAt) > now.getTime());
  if (kept.length === store.sessions.length) return store;
  return withSessions(store, kept);
}

/**
 * Creates a session for a principal and returns the new store plus the raw
 * session id (the only place the id ever appears server-side). Expired
 * sessions are pruned first; the per-principal cap evicts oldest-first.
 */
export function createSession(
  store: AuthzStore,
  principalId: string,
  now: Date = new Date()
): { store: AuthzStore; sessionId: string; session: AuthzSession } {
  const pruned = pruneExpiredSessions(store, now);
  const sessionId = generateSessionId();
  const session: AuthzSession = {
    idHash: hashToken(sessionId),
    principalId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };
  let sessions = [...(pruned.sessions ?? []), session];
  const mine = sessions.filter((sess) => sess.principalId === principalId);
  if (mine.length > MAX_SESSIONS_PER_PRINCIPAL) {
    const evict = new Set(
      mine.slice(0, mine.length - MAX_SESSIONS_PER_PRINCIPAL).map((sess) => sess.idHash)
    );
    sessions = sessions.filter((sess) => !evict.has(sess.idHash));
  }
  return { store: { ...pruned, sessions }, sessionId, session };
}

/** Finds a live session record by raw id. Expired ids resolve to null. */
export function findSession(
  store: AuthzStore,
  sessionId: string,
  now: Date = new Date()
): AuthzSession | null {
  let match: AuthzSession | null = null;
  for (const sess of store.sessions ?? []) {
    if (verifyTokenHash(sessionId, sess.idHash)) match = sess;
  }
  if (!match) return null;
  return Date.parse(match.expiresAt) > now.getTime() ? match : null;
}

/** Like findSession, but reports expiry distinctly (for audit). */
export function findSessionIncludingExpired(
  store: AuthzStore,
  sessionId: string
): { session: AuthzSession; expired: boolean } | null {
  for (const sess of store.sessions ?? []) {
    if (verifyTokenHash(sessionId, sess.idHash)) {
      return { session: sess, expired: Date.parse(sess.expiresAt) <= Date.now() };
    }
  }
  return null;
}

/** Removes one session (logout). Unknown ids are a no-op. */
export function revokeSession(store: AuthzStore, sessionId: string): AuthzStore {
  if (!store.sessions) return store;
  const idHash = hashToken(sessionId);
  const sessions = store.sessions.filter((sess) => sess.idHash !== idHash);
  if (sessions.length === store.sessions.length) return store;
  return withSessions(store, sessions);
}

/** Removes every session belonging to a principal. */
export function revokePrincipalSessions(store: AuthzStore, principalId: string): AuthzStore {
  if (!store.sessions) return store;
  const sessions = store.sessions.filter((sess) => sess.principalId !== principalId);
  if (sessions.length === store.sessions.length) return store;
  return withSessions(store, sessions);
}

// ---------------------------------------------------------------------------
// Store mutations (pure) with invariants — used by the CLI and admin API.
// ---------------------------------------------------------------------------

export class AuthzInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthzInvariantError';
  }
}

function activeOwners(store: AuthzStore): Principal[] {
  return store.principals.filter((p) => p.role === 'owner' && !p.disabled);
}

function assertNotLastOwner(
  store: AuthzStore,
  next: Principal[],
  action: string
): void {
  const before = activeOwners(store).length;
  const after = next.filter((p) => p.role === 'owner' && !p.disabled).length;
  if (before > 0 && after === 0) {
    throw new AuthzInvariantError(
      `Refusing to ${action}: the store must keep at least one active owner`
    );
  }
}

/**
 * Inserts or replaces a principal (matched by id) and returns the new
 * store. Enforces the last-owner invariant: the result must keep at least
 * one active owner if the input had one.
 */
export function upsertPrincipal(store: AuthzStore, principal: Principal): AuthzStore {
  const valid = principalSchema.parse(principal) as Principal;
  const exists = store.principals.some((p) => p.id === valid.id);
  const principals = exists
    ? store.principals.map((p) => (p.id === valid.id ? valid : p))
    : [...store.principals, valid];
  assertNotLastOwner(store, principals, `upsert principal ${valid.id}`);
  // Sessions survive unrelated edits, but the edited principal's own
  // sessions are revoked: role/grant/token changes must not leave stale
  // sessions exercising yesterday's privileges (WS5 §8.2).
  const sessions = (store.sessions ?? []).filter((sess) => sess.principalId !== valid.id);
  return { version: 1, principals, ...(sessions.length > 0 ? { sessions } : {}) };
}

/** Removes a principal by id and returns the new store. */
export function removePrincipal(store: AuthzStore, principalId: string): AuthzStore {
  if (!store.principals.some((p) => p.id === principalId)) {
    throw new AuthzInvariantError(`Unknown principal: ${principalId}`);
  }
  const principals = store.principals.filter((p) => p.id !== principalId);
  assertNotLastOwner(store, principals, `remove principal ${principalId}`);
  const sessions = (store.sessions ?? []).filter((sess) => sess.principalId !== principalId);
  return { version: 1, principals, ...(sessions.length > 0 ? { sessions } : {}) };
}
