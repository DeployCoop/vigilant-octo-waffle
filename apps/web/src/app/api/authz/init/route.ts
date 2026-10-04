import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  upsertPrincipal,
  createEmptyStore,
  generatePrincipalToken,
  hashToken,
  type Principal,
} from '@vow/orchestrator';
import { authorizeRequest, toPublicPrincipal, uniquePrincipalId } from '@/lib/authz';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

/**
 * Enables authorization: creates the store with a first owner principal
 * and returns that owner's token once (plan §9 "Enable authorization").
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
  if (loaded.status === 'ready' && loaded.store.principals.length > 0) {
    return NextResponse.json(
      {
        error: 'Authorization is already initialized. Use POST /api/authz/principals to add principals.',
        reason: 'authz_already_initialized',
      },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Owner';

  const store = loaded.status === 'ready' ? loaded.store : createEmptyStore();
  const token = generatePrincipalToken();
  const owner: Principal = {
    id: uniquePrincipalId(store, name),
    name,
    kind: 'human',
    role: 'owner',
    tokenHash: hashToken(token),
  };

  const next = upsertPrincipal(store, owner);
  saveAuthzStore(root, next);
  return NextResponse.json({ principal: toPublicPrincipal(owner), token }, { status: 201 });
}
