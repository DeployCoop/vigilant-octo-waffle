import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({ root: '' }));

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { GET, POST } from './route';
import { PATCH, DELETE } from './[id]/route';
import { POST as rotatePOST } from './[id]/rotate/route';
import { POST as initPOST } from '../init/route';

function req(
  method: string,
  url: string,
  token?: string,
  body?: unknown
) {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const listReq = (token?: string) =>
  req('GET', 'http://localhost:3000/api/authz/principals', token);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function initOwner(name = 'Olivia Owner') {
  const res = await initPOST(
    req('POST', 'http://localhost:3000/api/authz/init', undefined, { name })
  );
  expect(res.status).toBe(201);
  const data = await res.json();
  return data as { principal: { id: string; name: string }; token: string };
}

async function createPrincipal(token: string, body: Record<string, unknown>) {
  const res = await POST(
    req('POST', 'http://localhost:3000/api/authz/principals', token, body)
  );
  return { res, data: await res.json() };
}

beforeEach(() => {
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-admin-routes-'));
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/authz/init', () => {
  it('creates the store with a first owner and returns the token once', async () => {
    const { principal, token } = await initOwner();
    expect(token).toMatch(/^vow_/);
    expect(principal.name).toBe('Olivia Owner');

    // The store file exists, is YAML, and contains only the hash.
    const raw = fs.readFileSync(path.join(hoisted.root, '.vow', 'authz.yaml'), 'utf-8');
    expect(raw).toContain('sha256:');
    expect(raw).not.toContain(token);

    // The token authenticates as its owner.
    const list = await GET(listReq(token));
    expect(list.status).toBe(200);
  });

  it('refuses to initialize twice', async () => {
    const { token } = await initOwner();
    const res = await initPOST(
      req('POST', 'http://localhost:3000/api/authz/init', token, { name: 'Second' })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('authz_already_initialized');
  });
});

describe('GET /api/authz/principals', () => {
  it('reports authzEnabled false before init', async () => {
    const res = await GET(listReq());
    const data = await res.json();
    expect(data).toEqual({ authzEnabled: false, principals: [] });
  });

  it('lists principals without hashes, plus the catalog', async () => {
    const { token } = await initOwner();
    const res = await GET(listReq(token));
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('tokenHash');
    expect(raw).not.toContain('sha256:');
    const data = JSON.parse(raw);
    expect(data.principals).toHaveLength(1);
    expect(data.principals[0]).toMatchObject({ name: 'Olivia Owner', role: 'owner', hasToken: true });
    expect(data.permissions).toContain('users:manage_permissions');
    expect(data.roles).toContain('operator');
  });
});

describe('POST /api/authz/principals', () => {
  it('creates a token principal; the token resolves to that principal', async () => {
    const { token: ownerToken } = await initOwner();
    const { res, data } = await createPrincipal(ownerToken, {
      name: 'Vic Viewer',
      role: 'viewer',
    });
    expect(res.status).toBe(201);
    expect(data.token).toMatch(/^vow_/);
    expect(data.principal.id).toBe('p_vic-viewer');

    // Viewer token authenticates (403 on this owner-only route, not 401).
    const asViewer = await GET(listReq(data.token));
    expect(asViewer.status).toBe(403);
    // A garbage token does not authenticate.
    const asGarbage = await GET(listReq('vow_nope'));
    expect(asGarbage.status).toBe(401);
  });

  it('creates OIDC principals without a token', async () => {
    const { token: ownerToken } = await initOwner();
    const { res, data } = await createPrincipal(ownerToken, {
      name: 'Oidc Olga',
      role: 'operator',
      oidcSubject: 'olga@example.com',
    });
    expect(res.status).toBe(201);
    expect(data.token).toBeUndefined();
    expect(data.principal.oidcSubject).toBe('olga@example.com');
    expect(data.principal.hasToken).toBe(false);
  });

  it('rejects admins (users:manage_permissions is owner-only) and bad roles', async () => {
    const { token: ownerToken } = await initOwner();
    const { data: admin } = await createPrincipal(ownerToken, {
      name: 'Adam Admin',
      role: 'admin',
    });
    const asAdmin = await POST(
      req('POST', 'http://localhost:3000/api/authz/principals', admin.token, {
        name: 'Nope',
        role: 'viewer',
      })
    );
    expect(asAdmin.status).toBe(403);

    const badRole = await POST(
      req('POST', 'http://localhost:3000/api/authz/principals', ownerToken, {
        name: 'Bad',
        role: 'superuser',
      })
    );
    expect(badRole.status).toBe(400);
  });

  it('requires init first', async () => {
    const res = await POST(
      req('POST', 'http://localhost:3000/api/authz/principals', undefined, {
        name: 'Early',
        role: 'viewer',
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('authz_not_enabled');
  });
});

describe('PATCH /api/authz/principals/[id]', () => {
  it('full-set replaces role/grants/revocations and preserves the token', async () => {
    const { token: ownerToken } = await initOwner();
    const { data: viewer } = await createPrincipal(ownerToken, {
      name: 'Vic Viewer',
      role: 'viewer',
    });

    const res = await PATCH(
      req('PATCH', 'http://localhost:3000/api/authz/principals/p_vic-viewer', ownerToken, {
        role: 'operator',
        grants: [{ permission: 'k8s:exec', scope: { namespace: 'monitoring' } }],
        revocations: ['k8s:logs:read'],
        disabled: false,
      }),
      ctx('p_vic-viewer')
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()).principal;
    expect(updated.role).toBe('operator');
    expect(updated.grants).toEqual([
      { permission: 'k8s:exec', scope: { namespace: 'monitoring' } },
    ]);
    expect(updated.revocations).toEqual(['k8s:logs:read']);

    // The original token still authenticates after the replace.
    const asViewer = await GET(listReq(viewer.token));
    expect(asViewer.status).toBe(403);
  });

  it('refuses to demote or disable the last active owner', async () => {
    const { token: ownerToken, principal: owner } = await initOwner();
    const demote = await PATCH(
      req('PATCH', `http://localhost:3000/api/authz/principals/${owner.id}`, ownerToken, {
        role: 'viewer',
        grants: [],
        revocations: [],
        disabled: false,
      }),
      ctx(owner.id)
    );
    expect(demote.status).toBe(409);
    expect((await demote.json()).reason).toBe('authz_invariant');

    const disable = await PATCH(
      req('PATCH', `http://localhost:3000/api/authz/principals/${owner.id}`, ownerToken, {
        role: 'owner',
        grants: [],
        revocations: [],
        disabled: true,
      }),
      ctx(owner.id)
    );
    expect(disable.status).toBe(409);
  });

  it('404s for unknown principals', async () => {
    const { token: ownerToken } = await initOwner();
    const res = await PATCH(
      req('PATCH', 'http://localhost:3000/api/authz/principals/p_ghost', ownerToken, {
        role: 'viewer',
        grants: [],
        revocations: [],
        disabled: false,
      }),
      ctx('p_ghost')
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/authz/principals/[id]', () => {
  it('removes principals but refuses the last owner', async () => {
    const { token: ownerToken, principal: owner } = await initOwner();
    const { data: second } = await createPrincipal(ownerToken, {
      name: 'Second Owner',
      role: 'owner',
    });

    const removeFirst = await DELETE(
      req('DELETE', `http://localhost:3000/api/authz/principals/${owner.id}`, second.token),
      ctx(owner.id)
    );
    expect(removeFirst.status).toBe(200);

    const removeLast = await DELETE(
      req('DELETE', `http://localhost:3000/api/authz/principals/${second.principal.id}`, second.token),
      ctx(second.principal.id)
    );
    expect(removeLast.status).toBe(409);

    const removeGhost = await DELETE(
      req('DELETE', 'http://localhost:3000/api/authz/principals/p_ghost', second.token),
      ctx('p_ghost')
    );
    expect(removeGhost.status).toBe(404);
  });
});

describe('POST /api/authz/principals/[id]/rotate', () => {
  it('issues a new token and invalidates the old one', async () => {
    const { token: ownerToken } = await initOwner();
    const { data: viewer } = await createPrincipal(ownerToken, {
      name: 'Vic Viewer',
      role: 'viewer',
    });

    const res = await rotatePOST(
      req('POST', 'http://localhost:3000/api/authz/principals/p_vic-viewer/rotate', ownerToken),
      ctx('p_vic-viewer')
    );
    expect(res.status).toBe(200);
    const rotated = await res.json();
    expect(rotated.token).toMatch(/^vow_/);
    expect(rotated.token).not.toBe(viewer.token);

    expect((await GET(listReq(viewer.token))).status).toBe(401);
    expect((await GET(listReq(rotated.token))).status).toBe(403);
  });

  it('404s for unknown principals', async () => {
    const { token: ownerToken } = await initOwner();
    const res = await rotatePOST(
      req('POST', 'http://localhost:3000/api/authz/principals/p_ghost/rotate', ownerToken),
      ctx('p_ghost')
    );
    expect(res.status).toBe(404);
  });
});
