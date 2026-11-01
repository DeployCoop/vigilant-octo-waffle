import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  createEmptyStore,
  findPrincipalByToken,
  verifyTokenHash,
  createSession,
  findSession,
  revokeSession,
  revokePrincipalSessions,
  webhookTokensEqual,
  resolveVowLdapConfig,
  authenticateVowLdapUser,
  syncLdapPrincipal,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  type AuthzSession,
  type AuthzStore,
  type Principal,
} from '@vow/orchestrator';
import {
  BOOTSTRAP_OWNER_PRINCIPAL,
  callerCan,
  extractSessionId,
  recordAuthEvent,
  resolveAuthzContext,
} from '@/lib/authz';
import { getProjectRoot } from '@/lib/project';
import { apiError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

function loadReadyStore(): AuthzStore | null {
  const loaded = loadAuthzStore(getProjectRoot());
  return loaded.status === 'ready' ? loaded.store : null;
}

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
  // The app is served over plain HTTP on localhost/LAN by design, so the
  // cookie cannot be Secure-only; httpOnly + SameSite=Strict carry the
  // protection, and the session id is a revocable, expiring credential —
  // never the principal token itself.
  secure: false,
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

/**
 * Token or OpenLDAP credentials → session exchange (Plan II WS5 §8.2 + LDAP).
 * The browser presents its principal token or OpenLDAP `{ username, password }`
 * exactly once; in return it gets an httpOnly session cookie and never
 * persists credentials anywhere JS can reach. The legacy VOW_API_TOKEN is
 * accepted and binds the session to the synthetic bootstrap owner, matching
 * its header behavior.
 */
export async function POST(req: Request) {
  const projectRoot = getProjectRoot();
  const body = await req.json().catch(() => ({}));
  const username =
    typeof body?.username === 'string' && body.username.trim() ? body.username.trim() : null;
  const password = typeof body?.password === 'string' && body.password ? body.password : null;

  let store = loadReadyStore();
  const ldapCfg = resolveVowLdapConfig({ projectRoot, storeLdap: store?.ldap });

  // When OpenLDAP is enabled and a username+password login arrives before
  // .vow/authz.yaml exists, initialize an empty store with LDAP metadata so
  // JIT provisioning can create the principal immediately.
  if (!store) {
    if (username && password && ldapCfg.enabled) {
      store = {
        ...createEmptyStore(),
        ldap: {
          enabled: true,
          url: ldapCfg.url,
          baseDn: ldapCfg.baseDn,
          userSearchBase: ldapCfg.userSearchBase,
          userSearchFilter: ldapCfg.userSearchFilter,
          groupSearchBase: ldapCfg.groupSearchBase,
          groupSearchFilter: ldapCfg.groupSearchFilter,
          bindDn: ldapCfg.bindDn,
          ownerGroups: ldapCfg.ownerGroups,
          adminGroups: ldapCfg.adminGroups,
          operatorGroups: ldapCfg.operatorGroups,
          viewerGroups: ldapCfg.viewerGroups,
          defaultRole: ldapCfg.defaultRole,
          autoProvisionPrincipals: ldapCfg.autoProvisionPrincipals,
          allowLocalBreakGlass: ldapCfg.allowLocalBreakGlass,
        },
      };
    } else {
      return apiError(409, 'Authorization is not enabled yet.', { reason: 'authz_not_enabled' });
    }
  }

  // Credential paths, in order:
  // 1. An already-authenticated caller (header token, OIDC, or a live session
  //    cookie — re-exchange doubles as rotation) resolved by the shared authz layer.
  // 2. OpenLDAP `{ username, password }` directory bind + group-to-role sync
  //    (with optional break-glass local principal password fallback).
  // 3. Principal `{ token }` in the request body.
  const ctx = await resolveAuthzContext(req);
  let who: Principal | null = ctx.principal && !ctx.principal.disabled ? ctx.principal : null;
  let authSource: 'token' | 'ldap' | 'local' = 'token';
  let syncedGroups: string[] | undefined;

  if (!who && username && password) {
    if (ldapCfg.enabled) {
      const ldapRes = await authenticateVowLdapUser(username, password, ldapCfg);
      if (ldapRes.authenticated && ldapRes.username && ldapRes.role) {
        const synced = syncLdapPrincipal(
          store,
          {
            username: ldapRes.username,
            displayName: ldapRes.displayName,
            groups: ldapRes.groups,
            role: ldapRes.role,
          },
          {
            autoProvision: ldapCfg.autoProvisionPrincipals,
          }
        );
        if (!synced.principal) {
          if (synced.reason === 'disabled') {
            return apiError(403, 'Principal is disabled', { reason: 'deny_disabled_principal' });
          }
          return apiError(401, 'LDAP identity is not provisioned as a principal', {
            reason: 'deny_unknown_principal',
          });
        }
        store = synced.store;
        who = synced.principal;
        authSource = 'ldap';
        syncedGroups = ldapRes.groups;
      }
    }

    // Break-glass local fallback when LDAP did not authenticate and break-glass is allowed
    if (!who && (!ldapCfg.enabled || ldapCfg.allowLocalBreakGlass !== false)) {
      const lower = username.toLowerCase();
      const candidate = store.principals.find(
        (p) =>
          p.id.toLowerCase() === lower ||
          p.name.toLowerCase() === lower ||
          (p.ldapUid && p.ldapUid.toLowerCase() === lower) ||
          ((lower === 'admin' || lower === 'owner') && p.role === 'owner')
      );
      if (candidate && candidate.tokenHash && verifyTokenHash(password, candidate.tokenHash)) {
        if (candidate.disabled) return apiError(403, 'Principal is disabled');
        who = candidate;
        authSource = 'local';
      } else {
        const byToken = findPrincipalByToken(store, password);
        if (byToken && (byToken.name.toLowerCase() === lower || byToken.id.toLowerCase() === lower)) {
          if (byToken.disabled) return apiError(403, 'Principal is disabled');
          who = byToken;
          authSource = 'local';
        } else if (
          process.env.VOW_API_TOKEN &&
          webhookTokensEqual(password, process.env.VOW_API_TOKEN)
        ) {
          who = BOOTSTRAP_OWNER_PRINCIPAL;
          authSource = 'local';
        }
      }
    }

    if (!who) {
      return apiError(401, 'Invalid username or password');
    }
  }

  if (!who) {
    const token = typeof body?.token === 'string' && body.token.trim() ? body.token.trim() : null;
    if (token) {
      const principal = findPrincipalByToken(store, token);
      if (principal) {
        if (principal.disabled) return apiError(403, 'Principal is disabled');
        who = principal;
      } else if (
        process.env.VOW_API_TOKEN &&
        webhookTokensEqual(token, process.env.VOW_API_TOKEN)
      ) {
        who = BOOTSTRAP_OWNER_PRINCIPAL;
      }
    }
  }

  if (!who) return apiError(401, 'Invalid token');

  const { store: next, sessionId } = createSession(store, who.id);
  saveAuthzStore(projectRoot, next);
  recordAuthEvent(
    req,
    authSource === 'ldap' ? 'ldap_session_created' : 'session_created',
    who.id
  );

  const res = NextResponse.json({
    principal: {
      id: who.id,
      name: who.name,
      kind: who.kind,
      role: who.role,
      ...(who.ldapUid ? { ldapUid: who.ldapUid } : {}),
      ...(who.ldapGroups ? { ldapGroups: who.ldapGroups } : {}),
    },
    ...(authSource === 'ldap' ? { authSource: 'ldap', groups: syncedGroups ?? [] } : {}),
  });
  res.cookies.set(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
  return res;
}

/** How much of a session's stored id hash the API exposes and accepts. */
const ID_HASH_PREFIX_LENGTH = 16;
/** Shortest id-hash prefix a targeted revoke will act on. */
const MIN_ID_HASH_PREFIX_LENGTH = 12;

/** Store with its session list replaced (field omitted when empty). */
function withSessionList(store: AuthzStore, sessions: AuthzSession[]): AuthzStore {
  const next: AuthzStore = { ...store };
  if (sessions.length > 0) next.sessions = sessions;
  else delete next.sessions;
  return next;
}

/**
 * Lists live sessions (Plan III §4.3). Only hashes exist server-side, so
 * a session is identified by a prefix of its stored id hash — never by
 * a raw id. Any authenticated caller sees their own sessions; callers
 * holding `users:manage_permissions` (the principals-management gate)
 * see every session. Expired sessions are excluded.
 */
export async function GET(req: Request) {
  const store = loadReadyStore();
  if (!store) {
    return apiError(409, 'Authorization is not enabled yet.', { reason: 'authz_not_enabled' });
  }
  const ctx = await resolveAuthzContext(req);
  const me = ctx.principal && !ctx.principal.disabled ? ctx.principal : null;
  if (!me) return apiError(401, 'Authentication required');

  const canManage = await callerCan(req, 'users:manage_permissions');
  const now = Date.now();
  const sessions = (store.sessions ?? [])
    .filter((sess) => Date.parse(sess.expiresAt) > now)
    .filter((sess) => canManage || sess.principalId === me.id)
    .map((sess) => ({
      idHashPrefix: sess.idHash.slice(0, ID_HASH_PREFIX_LENGTH),
      principalId: sess.principalId,
      createdAt: sess.createdAt,
      expiresAt: sess.expiresAt,
    }));
  return NextResponse.json({ sessions });
}

/**
 * Targeted revocation (Plan III §4.3): DELETE with a JSON body of
 * `{ principalId }` revokes every session of that principal, and
 * `{ idHashPrefix }` revokes the one session whose stored id hash starts
 * with the prefix (at least 12 chars, must match exactly one session);
 * both together require the prefix to belong to the principal. A caller
 * may target only their own sessions unless they hold
 * `users:manage_permissions`. Responds `{ ok: true, revoked: n }` and
 * fires the `session_revoked` audit event when anything was revoked.
 */
async function targetedRevoke(
  req: Request,
  target: { principalId: string | null; idHashPrefix: string | null }
) {
  const store = loadReadyStore();
  if (!store) {
    return apiError(409, 'Authorization is not enabled yet.', { reason: 'authz_not_enabled' });
  }
  const ctx = await resolveAuthzContext(req);
  const me = ctx.principal && !ctx.principal.disabled ? ctx.principal : null;
  if (!me) return apiError(401, 'Authentication required');
  const canManage = await callerCan(req, 'users:manage_permissions');
  const all = store.sessions ?? [];

  let targetPrincipalId: string;
  let next: AuthzStore;
  let revoked: number;

  if (target.idHashPrefix) {
    const prefix = target.idHashPrefix;
    if (prefix.length < MIN_ID_HASH_PREFIX_LENGTH) {
      return apiError(
        400,
        `idHashPrefix must be at least ${MIN_ID_HASH_PREFIX_LENGTH} characters`
      );
    }
    const matches = all.filter((sess) => sess.idHash.startsWith(prefix));
    if (matches.length === 0) {
      return apiError(404, 'No session matches that id hash prefix');
    }
    if (matches.length > 1) {
      return apiError(400, 'idHashPrefix is ambiguous — provide more characters');
    }
    const session = matches[0];
    if (target.principalId && target.principalId !== session.principalId) {
      return apiError(400, 'idHashPrefix does not belong to principalId');
    }
    targetPrincipalId = session.principalId;
    if (targetPrincipalId !== me.id && !canManage) {
      return apiError(403, 'You can only revoke your own sessions');
    }
    next = withSessionList(
      store,
      all.filter((sess) => sess.idHash !== session.idHash)
    );
    revoked = 1;
  } else {
    targetPrincipalId = target.principalId as string;
    if (targetPrincipalId !== me.id && !canManage) {
      return apiError(403, 'You can only revoke your own sessions');
    }
    const known =
      store.principals.some((p) => p.id === targetPrincipalId) ||
      all.some((sess) => sess.principalId === targetPrincipalId);
    if (!known) return apiError(404, 'Unknown principal');
    revoked = all.filter((sess) => sess.principalId === targetPrincipalId).length;
    next = revokePrincipalSessions(store, targetPrincipalId);
  }

  if (next !== store) saveAuthzStore(getProjectRoot(), next);
  if (revoked > 0) recordAuthEvent(req, 'session_revoked', targetPrincipalId);

  const res = NextResponse.json({ ok: true, revoked });
  // If the caller's own presented session was among the revoked, it no
  // longer resolves — clear the cookie so the browser signs out cleanly.
  const presented = extractSessionId(req);
  if (presented && !findSession(next, presented)) {
    res.cookies.set(SESSION_COOKIE_NAME, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  }
  return res;
}

/**
 * Logout, or targeted revocation when a JSON body names a target.
 * With no body (or no target fields) this is exactly the historical
 * behavior: revoke the presented session (if any) and clear the cookie.
 */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const principalId =
    typeof body?.principalId === 'string' && body.principalId !== '' ? body.principalId : null;
  const idHashPrefix =
    typeof body?.idHashPrefix === 'string' && body.idHashPrefix !== '' ? body.idHashPrefix : null;
  if (principalId || idHashPrefix) {
    return targetedRevoke(req, { principalId, idHashPrefix });
  }

  const sessionId = extractSessionId(req);
  const store = loadReadyStore();
  if (sessionId && store) {
    const next = revokeSession(store, sessionId);
    if (next !== store) {
      saveAuthzStore(getProjectRoot(), next);
      recordAuthEvent(req, 'session_revoked', null);
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
