import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  findPrincipalByToken,
  createSession,
  revokeSession,
  webhookTokensEqual,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  type AuthzStore,
} from '@vow/orchestrator';
import {
  BOOTSTRAP_OWNER_PRINCIPAL,
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
 * Token → session exchange (Plan II WS5 §8.2). The browser presents its
 * principal token exactly once; in return it gets an httpOnly session
 * cookie and never persists the token anywhere JS can reach. The legacy
 * VOW_API_TOKEN is accepted and binds the session to the synthetic
 * bootstrap owner, matching its header behavior.
 */
export async function POST(req: Request) {
  const store = loadReadyStore();
  if (!store) {
    return apiError(409, 'Authorization is not enabled yet.', { reason: 'authz_not_enabled' });
  }

  // Credential paths, in order: an already-authenticated caller (header
  // token, OIDC, or a live session cookie — re-exchange doubles as
  // rotation) resolved by the shared authz layer; otherwise the token in
  // the request body, which is how the sign-in form presents it.
  const ctx = await resolveAuthzContext(req);
  let who = ctx.principal && !ctx.principal.disabled ? ctx.principal : null;

  if (!who) {
    const body = await req.json().catch(() => ({}));
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
  saveAuthzStore(getProjectRoot(), next);
  recordAuthEvent(req, 'session_created', who.id);

  const res = NextResponse.json({
    principal: { id: who.id, name: who.name, kind: who.kind, role: who.role },
  });
  res.cookies.set(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
  return res;
}

/** Logout: revoke the presented session (if any) and clear the cookie. */
export async function DELETE(req: Request) {
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
