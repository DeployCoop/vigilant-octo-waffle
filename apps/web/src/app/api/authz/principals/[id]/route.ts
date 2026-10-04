import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  upsertPrincipal,
  removePrincipal,
  ROLES,
  type Principal,
  type Role,
} from '@vow/orchestrator';
import { authorizeRequest, toPublicPrincipal } from '@/lib/authz';
import { getProjectRoot } from '@/lib/project';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function loadReadyStore() {
  const loaded = loadAuthzStore(getProjectRoot());
  return loaded.status === 'ready' ? loaded.store : null;
}

function notFound(id: string) {
  return apiError(404, `Unknown principal: ${id}`);
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
    return apiError(409, 'Authorization is not enabled', {
      reason: 'authz_not_enabled',
    });
  }
  const existing = store.principals.find((p) => p.id === id);
  if (!existing) return notFound(id);

  const body = await req.json().catch(() => ({}));
  const role = body.role as Role;
  if (!ROLES.includes(role)) {
    return apiError(400, `role must be one of: ${ROLES.join(', ')}`);
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
    return routeError(err, {
      route: 'PATCH /api/authz/principals/[id]',
      status: 400,
    });
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
    return apiError(409, 'Authorization is not enabled', {
      reason: 'authz_not_enabled',
    });
  }
  if (!store.principals.some((p) => p.id === id)) return notFound(id);

  try {
    const updated = removePrincipal(store, id);
    saveAuthzStore(getProjectRoot(), updated);
  } catch (err) {
    return routeError(err, {
      route: 'DELETE /api/authz/principals/[id]',
      status: 400,
    });
  }
  return NextResponse.json({ success: true, id });
}
