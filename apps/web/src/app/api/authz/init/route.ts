import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  upsertPrincipal,
  createEmptyStore,
  generatePrincipalToken,
  hashPassword,
  hashToken,
  MIN_PASSWORD_LENGTH,
  ensureDevCertificate,
  type Principal,
} from '@vow/orchestrator';
import { authorizeRequest, extractRequestToken, isLocalBoardRequest, toPublicPrincipal, uniquePrincipalId } from '@/lib/authz';
import { webhookTokensEqual } from '@vow/orchestrator';
import { getProjectRoot } from '@/lib/project';
import { apiError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

/**
 * Enables authorization: creates the store with a first owner principal
 * and returns that owner's token once (plan §9 "Enable authorization").
 *
 * Supports an optional explicit password/token (`body.password` or `body.token`).
 *
 * Reachable while authz is disabled or the store is still empty — in
 * both states the guard admits the local board / migration path — and
 * by existing owners afterwards is refused: once principals exist, use
 * POST /api/authz/principals.
 */
export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'users:manage_permissions');
  if (denied) return denied;

  const root = getProjectRoot();
  const loaded = loadAuthzStore(root);

  // BUG FIX (2026-10-14 sweep): while authz is DISABLED (the default —
  // no store file), decide() allows every caller, and this route never
  // consulted locality: anyone who could reach the port could create
  // the first owner with a self-chosen password and lock the operator
  // out (subsequent inits are 409-refused). Bootstrap now requires the
  // local board, matching the empty-store path in decide(). Operators
  // who need remote bootstrap can use the authz CLI on the host.
  const needsBootstrap = loaded.status !== 'ready' || loaded.store.principals.length === 0;
  // BUG FIX (bug hunt B9, part 1): loopback is derived from the
  // client-controlled Host header, so loopback alone must not suffice
  // when a bootstrap token is configured. A caller presenting a fake
  // `vow_…` bearer token passes the middleware (which defers
  // vow_-prefixed tokens to route guards) and, with authz disabled,
  // the route guard — so without this check a remote caller with a
  // spoofed Host header could mint the first owner. When VOW_API_TOKEN
  // is set, bootstrap requires that exact token; the loopback check
  // below still applies when no token is configured. (Socket-level
  // peer detection is not available in the App Router, so this is
  // defense in depth, not a replacement for the loopback-only bind.)
  if (needsBootstrap && process.env.VOW_API_TOKEN) {
    const presented = extractRequestToken(req);
    if (!presented || !webhookTokensEqual(presented, process.env.VOW_API_TOKEN)) {
      return apiError(
        403,
        'Authorization bootstrap requires the configured VOW_API_TOKEN when one is set.',
        { reason: 'bootstrap_requires_token' }
      );
    }
  } else if (needsBootstrap && !isLocalBoardRequest(req)) {
    return apiError(
      403,
      'Authorization bootstrap is only available from the local board (loopback). Enable authz locally first, or use the authz CLI on the host.',
      { reason: 'bootstrap_requires_local_board' }
    );
  }

  if (loaded.status === 'ready' && loaded.store.principals.length > 0) {
    return apiError(
      409,
      'Authorization is already initialized. Use POST /api/authz/principals to add principals.',
      { reason: 'authz_already_initialized' }
    );
  }

  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Owner';

  const customPassword =
    typeof body.password === 'string' && body.password.trim()
      ? body.password.trim()
      : typeof body.token === 'string' && body.token.trim()
        ? body.token.trim()
        : null;

  if (customPassword && customPassword.length < MIN_PASSWORD_LENGTH) {
    return apiError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, {
      reason: 'password_too_short',
    });
  }

  const store = loaded.status === 'ready' ? loaded.store : createEmptyStore();
  const token = customPassword ?? generatePrincipalToken();
  const owner: Principal = {
    id: uniquePrincipalId(store, name),
    name,
    kind: 'human',
    role: 'owner',
    // A human-chosen password gets the scrypt scheme; a generated token sha256.
    tokenHash: customPassword ? hashPassword(customPassword) : hashToken(token),
  };

  const next = upsertPrincipal(store, owner);
  saveAuthzStore(root, next);

  // Ensure mkcert TLS certificate is generated for HTTPS hosting
  try {
    await ensureDevCertificate(root);
  } catch (err) {
    console.warn(
      '[authz/init] Note on dev TLS certificate generation:',
      err instanceof Error ? err.message : String(err)
    );
  }

  return NextResponse.json(
    {
      principal: toPublicPrincipal(owner),
      token,
      isCustomPassword: Boolean(customPassword),
      tlsReady: true,
    },
    { status: 201 }
  );
}

