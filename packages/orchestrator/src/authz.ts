import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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

const grantSchema = z.object({
  permission: permissionSchema,
  scope: grantScopeSchema.optional(),
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

  let mtimeMs: number | null = null;
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
 * explicit grants (scoped grants become CASL conditions), then revocations
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
  | 'deny_revoked'
  | 'deny_store_invalid';

export interface Decision {
  allowed: boolean;
  reason: DecisionReason;
  principalId?: string;
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
    if (grants.some((g) => grantCoversTarget(g, target))) {
      return allow('allow_explicit_grant', principal);
    }
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
export function hashToken(token: string): string {
  return TOKEN_HASH_PREFIX + createHash('sha256').update(token).digest('hex');
}

/** Constant-time check of a presented token against a stored hash. */
export function verifyTokenHash(token: string, tokenHash: string): boolean {
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
  return { version: 1, principals };
}

/** Removes a principal by id and returns the new store. */
export function removePrincipal(store: AuthzStore, principalId: string): AuthzStore {
  if (!store.principals.some((p) => p.id === principalId)) {
    throw new AuthzInvariantError(`Unknown principal: ${principalId}`);
  }
  const principals = store.principals.filter((p) => p.id !== principalId);
  assertNotLastOwner(store, principals, `remove principal ${principalId}`);
  return { version: 1, principals };
}
