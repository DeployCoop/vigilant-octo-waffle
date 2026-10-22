import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({ root: '' }));

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { PATCH, DELETE } from './route';
import { GET, POST } from '../route';
import { POST as initPOST } from '../../init/route';
import { createSession, loadAuthzStore, saveAuthzStore } from '@vow/orchestrator';

/**
 * Behavior tests for PATCH/DELETE /api/authz/principals/[id] (Plan III
 * §5.1 tranche 1). The collection suite (../route.test.ts) already pins
 * the full-set replace, the last-owner invariant, and the 404s; this file
 * pins what it does not: grant context through PATCH, the permission
 * gate on these two verbs, and the WS5 session-revocation side effects
 * of an edit or a removal.
 */

function req(method: string, url: string, token?: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const idUrl = (id: string) => `http://localhost:3000/api/authz/principals/${id}`;

async function initOwner() {
  const res = await initPOST(
    req('POST', 'http://localhost:3000/api/authz/init', undefined, { name: 'Olivia Owner' })
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { principal: { id: string }; token: string };
}

async function createPrincipal(token: string, body: Record<string, unknown>) {
  const res = await POST(req('POST', 'http://localhost:3000/api/authz/principals', token, body));
  expect(res.status).toBe(201);
  return (await res.json()) as { principal: { id: string }; token: string };
}

/** Seeds a live session for a principal straight into the on-disk store. */
function seedSession(principalId: string) {
  const loaded = loadAuthzStore(hoisted.root);
  if (loaded.status !== 'ready') throw new Error('store not ready');
  const { store, session } = createSession(loaded.store, principalId, new Date());
  saveAuthzStore(hoisted.root, store);
  return session;
}

function storedSessions() {
  const loaded = loadAuthzStore(hoisted.root);
  if (loaded.status !== 'ready') throw new Error('store not ready');
  return loaded.store.sessions ?? [];
}

beforeEach(() => {
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-principals-id-'));
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('PATCH /api/authz/principals/[id] — grant context (Plan III §5.1)', () => {
  it('round-trips a grant context verbatim and persists it to the store', async () => {
    const owner = await initOwner();
    const viewer = await createPrincipal(owner.token, { name: 'Vic Viewer', role: 'viewer' });
    const context = {
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2027-01-01T00:00:00.000Z',
      source: 'loopback',
      authMethod: 'session',
    };

    const res = await PATCH(
      req('PATCH', idUrl(viewer.principal.id), owner.token, {
        role: 'viewer',
        grants: [{ permission: 'apps:deploy', context }],
        revocations: [],
        disabled: false,
      }),
      ctx(viewer.principal.id)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).principal.grants).toEqual([
      { permission: 'apps:deploy', context },
    ]);

    // Persisted: a fresh list read and the YAML on disk both carry it.
    const list = await GET(req('GET', 'http://localhost:3000/api/authz/principals', owner.token));
    const listed = (await list.json()).principals.find(
      (p: { id: string }) => p.id === viewer.principal.id
    );
    expect(listed.grants).toEqual([{ permission: 'apps:deploy', context }]);
    const raw = fs.readFileSync(path.join(hoisted.root, '.vow', 'authz.yaml'), 'utf-8');
    expect(raw).toContain('authMethod: session');
    expect(raw).toContain('notAfter:');
  });

  it('rejects a malformed grant context with a 400 and changes nothing', async () => {
    const owner = await initOwner();
    const viewer = await createPrincipal(owner.token, { name: 'Vic Viewer', role: 'viewer' });

    const res = await PATCH(
      req('PATCH', idUrl(viewer.principal.id), owner.token, {
        role: 'viewer',
        grants: [{ permission: 'apps:deploy', context: { notBefore: 'not-a-date' } }],
        revocations: [],
        disabled: false,
      }),
      ctx(viewer.principal.id)
    );
    expect(res.status).toBe(400);

    const loaded = loadAuthzStore(hoisted.root);
    if (loaded.status !== 'ready') throw new Error('store not ready');
    const stored = loaded.store.principals.find((p) => p.id === viewer.principal.id);
    expect(stored?.grants ?? []).toEqual([]);
  });
});

describe('PATCH/DELETE /api/authz/principals/[id] — permission gate', () => {
  it('PATCH denies a non-manager token with 403 and an anonymous caller with 401', async () => {
    const owner = await initOwner();
    const viewer = await createPrincipal(owner.token, { name: 'Vic Viewer', role: 'viewer' });
    const body = { role: 'operator', grants: [], revocations: [], disabled: false };

    const asViewer = await PATCH(req('PATCH', idUrl(viewer.principal.id), viewer.token, body), ctx(viewer.principal.id));
    expect(asViewer.status).toBe(403);

    const asAnon = await PATCH(req('PATCH', idUrl(viewer.principal.id), undefined, body), ctx(viewer.principal.id));
    expect(asAnon.status).toBe(401);
  });

  it('DELETE denies a non-manager token with 403', async () => {
    const owner = await initOwner();
    const viewer = await createPrincipal(owner.token, { name: 'Vic Viewer', role: 'viewer' });
    const second = await createPrincipal(owner.token, { name: 'Second Viewer', role: 'viewer' });

    const res = await DELETE(
      req('DELETE', idUrl(second.principal.id), viewer.token),
      ctx(second.principal.id)
    );
    expect(res.status).toBe(403);

    const loaded = loadAuthzStore(hoisted.root);
    if (loaded.status !== 'ready') throw new Error('store not ready');
    expect(loaded.store.principals.some((p) => p.id === second.principal.id)).toBe(true);
  });
});

describe('PATCH/DELETE /api/authz/principals/[id] — session side effects (WS5)', () => {
  it("PATCH revokes the edited principal's sessions and leaves other principals' alone", async () => {
    const owner = await initOwner();
    const viewer = await createPrincipal(owner.token, { name: 'Vic Viewer', role: 'viewer' });
    seedSession(viewer.principal.id);
    seedSession(owner.principal.id);
    expect(storedSessions()).toHaveLength(2);

    const res = await PATCH(
      req('PATCH', idUrl(viewer.principal.id), owner.token, {
        role: 'operator',
        grants: [],
        revocations: [],
        disabled: false,
      }),
      ctx(viewer.principal.id)
    );
    expect(res.status).toBe(200);

    const remaining = storedSessions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].principalId).toBe(owner.principal.id);
  });

  it("DELETE removes the principal's sessions along with the principal", async () => {
    const owner = await initOwner();
    const viewer = await createPrincipal(owner.token, { name: 'Vic Viewer', role: 'viewer' });
    seedSession(viewer.principal.id);
    seedSession(owner.principal.id);
    expect(storedSessions()).toHaveLength(2);

    const res = await DELETE(
      req('DELETE', idUrl(viewer.principal.id), owner.token),
      ctx(viewer.principal.id)
    );
    expect(res.status).toBe(200);

    const remaining = storedSessions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].principalId).toBe(owner.principal.id);
  });
});
