import { createMongoAbility, type MongoAbility, type RawRuleOf } from '@casl/ability';

/**
 * Client-side mirror of the orchestrator's ability model. The server
 * stays authoritative — this layer only decides which controls to show
 * or enable, using the exact rules `GET /api/authz/me` returns.
 */

export type ClientAbility = MongoAbility<
  [string, string | Record<string, unknown>]
>;

export interface MePrincipal {
  id: string;
  name: string;
  kind: string;
  role: string;
}

export interface MeResponse {
  authzEnabled: boolean;
  principal: MePrincipal | null;
  localBoard?: boolean;
  rules: Array<Record<string, unknown>>;
  reason?: string;
}

export type AbilityStatus =
  | 'loading'
  | 'disabled'
  | 'ready'
  | 'local-board'
  | 'unauthenticated'
  | 'unknown-principal';

const SUBJECT_TYPE = 'AuthzTarget';

/** Tags a target the same way the orchestrator's authzSubject() does. */
export function subjectFor(target?: {
  appId?: string;
  namespace?: string;
}): Record<string, unknown> {
  return { ...(target ?? {}), __caslSubjectType__: SUBJECT_TYPE };
}

/** An ability that permits everything (authz disabled / local board). */
export function permissiveAbility(): ClientAbility {
  return createMongoAbility([{ action: 'manage', subject: 'all' }]);
}

/** An ability that permits nothing (no valid credential). */
export function emptyAbility(): ClientAbility {
  return createMongoAbility([]);
}

export function abilityFromRules(rules: Array<Record<string, unknown>>): ClientAbility {
  return createMongoAbility(rules as unknown as Array<RawRuleOf<ClientAbility>>);
}

/** Derives the client ability + status from a /api/authz/me outcome. */
export function abilityFromMe(
  me: MeResponse | null,
  httpStatus: number
): { status: AbilityStatus; ability: ClientAbility } {
  if (me && me.authzEnabled === false) {
    return { status: 'disabled', ability: permissiveAbility() };
  }
  if (me && me.localBoard) {
    return { status: 'local-board', ability: permissiveAbility() };
  }
  if (me && me.principal) {
    return { status: 'ready', ability: abilityFromRules(me.rules ?? []) };
  }
  if (httpStatus === 401) {
    return {
      status: me?.reason === 'deny_unknown_principal' ? 'unknown-principal' : 'unauthenticated',
      ability: emptyAbility(),
    };
  }
  return { status: 'unauthenticated', ability: emptyAbility() };
}

// ---------------------------------------------------------------------------
// Principal token storage + fetch interception
// ---------------------------------------------------------------------------

export const PRINCIPAL_TOKEN_KEY = 'vow_token';

export function readStoredToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const local = window.localStorage.getItem(PRINCIPAL_TOKEN_KEY);
    if (local && local.trim()) return local.trim();
    const session = window.sessionStorage.getItem(PRINCIPAL_TOKEN_KEY);
    if (session && session.trim()) return session.trim();
    if (typeof document !== 'undefined') {
      const match = document.cookie.match(/(?:^|;\s*)vow_token=([^;]+)/);
      if (match && match[1]) {
        const decoded = decodeURIComponent(match[1]).trim();
        if (decoded) return decoded;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(PRINCIPAL_TOKEN_KEY, token);
      window.sessionStorage.setItem(PRINCIPAL_TOKEN_KEY, token);
      if (typeof document !== 'undefined') {
        document.cookie = `vow_token=${encodeURIComponent(token)}; path=/; SameSite=Lax`;
      }
    } else {
      window.localStorage.removeItem(PRINCIPAL_TOKEN_KEY);
      window.sessionStorage.removeItem(PRINCIPAL_TOKEN_KEY);
      if (typeof document !== 'undefined') {
        document.cookie = `vow_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
      }
    }
  } catch {
    // Storage unavailable (private mode); the session simply won't persist.
  }
}

let interceptorInstalled = false;

/**
 * Wraps window.fetch so same-origin /api/* requests carry the stored
 * principal token (Q1: localStorage tokens). Requests that already set
 * an Authorization header (e.g. the webhook helper) are left untouched.
 * Installed once; the token is read lazily per request.
 */
export function installAuthFetchInterceptor(): void {
  if (interceptorInstalled || typeof window === 'undefined') return;
  interceptorInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = readStoredToken();
    if (token) {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const isApi =
        url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
      if (isApi) {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined)
        );
        if (!headers.has('authorization')) {
          headers.set('authorization', `Bearer ${token}`);
          return original(input, { ...init, headers });
        }
      }
    }
    return original(input, init);
  };
}
