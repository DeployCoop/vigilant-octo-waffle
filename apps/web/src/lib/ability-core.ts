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
// Session exchange (WS5 §8.2)
//
// The browser never persists the principal token. Sign-in exchanges it
// once for an httpOnly session cookie (POST /api/authz/session); after
// that, the cookie rides every request — fetch and EventSource alike —
// and GET /api/authz/me is the signed-in probe. Nothing credential-shaped
// is stored anywhere page JS can reach it.
// ---------------------------------------------------------------------------

/** Exchanges a principal token for a session cookie. True on success. */
export async function exchangeTokenForSession(token: string): Promise<boolean> {
  try {
    const res = await fetch('/api/authz/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Revokes the current session server-side and clears the cookie. */
export async function endSession(): Promise<void> {
  try {
    await fetch('/api/authz/session', { method: 'DELETE' });
  } catch {
    // Already offline or signed out — nothing else to do.
  }
}
