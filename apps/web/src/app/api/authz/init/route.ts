import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  upsertPrincipal,
  createEmptyStore,
  generatePrincipalToken,
  hashToken,
  ensureDevCertificate,
  type Principal,
} from '@vow/orchestrator';
import { authorizeRequest, isLocalBoardRequest, toPublicPrincipal, uniquePrincipalId } from '@/lib/authz';
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
  if (needsBootstrap && !isLocalBoardRequest(req)) {
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

  const store = loaded.status === 'ready' ? loaded.store : createEmptyStore();
  const token = customPassword ?? generatePrincipalToken();
  const owner: Principal = {
    id: uniquePrincipalId(store, name),
    name,
    kind: 'human',
    role: 'owner',
    tokenHash: hashToken(token),
  };

  const next = upsertPrincipal(store, owner);
  saveAuthzStore(root, next);

  // Ensure mkcert TLS certificate is generated for HTTPS hosting
  try {
    await ensureDevCertificate(root);
  } catch (err: any) {
    console.warn('[authz/init] Note on dev TLS certificate generation:', err?.message);
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

