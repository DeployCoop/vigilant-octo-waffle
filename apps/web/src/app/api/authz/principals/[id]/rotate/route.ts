import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  upsertPrincipal,
  generatePrincipalToken,
  hashToken,
  AuthzInvariantError,
} from '@vow/orchestrator';
import { authorizeRequest, toPublicPrincipal } from '@/lib/authz';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

/**
 * Issues a fresh token for a principal, invalidating the old one. The
 * plaintext token is returned once; only its hash is stored. Works for
 * OIDC-mapped principals too (adds a token credential alongside).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorizeRequest(req, 'users:manage_permissions');
  if (denied) return denied;

  const { id } = await params;
  const loaded = loadAuthzStore(getProjectRoot());
  if (loaded.status !== 'ready') {
    return NextResponse.json(
      { error: 'Authorization is not enabled', reason: 'authz_not_enabled' },
      { status: 409 }
    );
  }
  const existing = loaded.store.principals.find((p) => p.id === id);
  if (!existing) {
    return NextResponse.json({ error: `Unknown principal: ${id}` }, { status: 404 });
  }

  const token = generatePrincipalToken();
  const next = { ...existing, tokenHash: hashToken(token) };
  try {
    const updated = upsertPrincipal(loaded.store, next);
    saveAuthzStore(getProjectRoot(), updated);
  } catch (err) {
    if (err instanceof AuthzInvariantError) {
      return NextResponse.json({ error: err.message, reason: 'authz_invariant' }, { status: 409 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ principal: toPublicPrincipal(next), token });
}
