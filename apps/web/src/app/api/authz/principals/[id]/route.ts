import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  upsertPrincipal,
  removePrincipal,
  AuthzInvariantError,
  ROLES,
  type Principal,
  type Role,
} from '@vow/orchestrator';
import { authorizeRequest, toPublicPrincipal } from '@/lib/authz';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function loadReadyStore() {
  const loaded = loadAuthzStore(getProjectRoot());
  return loaded.status === 'ready' ? loaded.store : null;
}

function notFound(id: string) {
  return NextResponse.json({ error: `Unknown principal: ${id}` }, { status: 404 });
}

function invariantOr400(err: unknown) {
  if (err instanceof AuthzInvariantError) {
    return NextResponse.json({ error: err.message, reason: 'authz_invariant' }, { status: 409 });
  }
  return NextResponse.json({ error: (err as Error).message }, { status: 400 });
}

/**
 * Full-set replace of a principal's role, grants, revocations, and
 * disabled flag (plan §6.3 — no partial merges). Identity fields (id,
 * kind) and the token hash are preserved from the stored record; the
 * hash is never accepted from a client.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await authorizeRequest(req, 'users:manage_permissions');
  if (denied) return denied;

  const { id } = await params;
  const store = loadReadyStore();
  if (!store) {
    return NextResponse.json(
      { error: 'Authorization is not enabled', reason: 'authz_not_enabled' },
      { status: 409 }
    );
  }
  const existing = store.principals.find((p) => p.id === id);
  if (!existing) return notFound(id);

  const body = await req.json().catch(() => ({}));
  const role = body.role as Role;
  if (!ROLES.includes(role)) {
    return NextResponse.json(
      { error: `role must be one of: ${ROLES.join(', ')}` },
      { status: 400 }
    );
  }

  const next: Principal = {
    ...existing,
    role,
    grants: Array.isArray(body.grants) ? body.grants : [],
    revocations: Array.isArray(body.revocations) ? body.revocations : [],
    disabled: body.disabled === true,
  };
  if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();
  if (body.oidcSubject === null) {
    delete next.oidcSubject;
  } else if (typeof body.oidcSubject === 'string' && body.oidcSubject.trim()) {
    next.oidcSubject = body.oidcSubject.trim();
  }

  try {
    const updated = upsertPrincipal(store, next);
    saveAuthzStore(getProjectRoot(), updated);
  } catch (err) {
    return invariantOr400(err);
  }
  return NextResponse.json({ principal: toPublicPrincipal(next) });
}

/** Removes a principal. The last active owner cannot be removed. */
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await authorizeRequest(req, 'users:manage_permissions');
  if (denied) return denied;

  const { id } = await params;
  const store = loadReadyStore();
  if (!store) {
    return NextResponse.json(
      { error: 'Authorization is not enabled', reason: 'authz_not_enabled' },
      { status: 409 }
    );
  }
  if (!store.principals.some((p) => p.id === id)) return notFound(id);

  try {
    const updated = removePrincipal(store, id);
    saveAuthzStore(getProjectRoot(), updated);
  } catch (err) {
    return invariantOr400(err);
  }
  return NextResponse.json({ success: true, id });
}
