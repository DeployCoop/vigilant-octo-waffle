import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({ root: '' }));

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { POST as rotatePOST } from './route';
import { POST } from '../../route';
import { POST as initPOST } from '../../../init/route';
import { createSession, loadAuthzStore, saveAuthzStore } from '@vow/orchestrator';

/**
 * Behavior tests for POST /api/authz/principals/[id]/rotate (Plan III
 * §5.1 tranche 1). The collection suite (../../route.test.ts) already
 * pins the new-token/old-token invalidation and the 404; this file pins
 * what it does not: the stored hash actually changes, rotation revokes
 * the principal's WS5 sessions, and the permission gate on this verb.
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
const rotateUrl = (id: string) =>
  `http://localhost:3000/api/authz/principals/${id}/rotate`;

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

function loadReady() {
  const loaded = loadAuthzStore(hoisted.root);
  if (loaded.status !== 'ready') throw new Error('store not ready');
  return loaded.store;
}

function seedSession(principalId: string) {
  const { store } = createSession(loadReady(), principalId, new Date());
  saveAuthzStore(hoisted.root, store);
}

beforeEach(() => {
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-principals-rotate-'));
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/authz/principals/[id]/rotate — stored state (Plan III §5.1)', () => {
  it('changes the stored token hash and revokes only that principal’s sessions', async () => {
    const owner = await initOwner();
    const viewer = await createPrincipal(owner.token, { name: 'Vic Viewer', role: 'viewer' });
    seedSession(viewer.principal.id);
    seedSession(owner.principal.id);
    const hashBefore = loadReady().principals.find(
      (p) => p.id === viewer.principal.id
    )?.tokenHash;
    expect(hashBefore).toBeTruthy();
    expect(loadReady().sessions).toHaveLength(2);

    const res = await rotatePOST(
      req('POST', rotateUrl(viewer.principal.id), owner.token),
      ctx(viewer.principal.id)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).token).toMatch(/^vow_/);

    const after = loadReady();
    const hashAfter = after.principals.find((p) => p.id === viewer.principal.id)?.tokenHash;
    expect(hashAfter).toBeTruthy();
    expect(hashAfter).not.toBe(hashBefore);

    // Rotation revokes the rotated principal's sessions (WS5); the
    // owner's session is untouched.
    expect(after.sessions).toHaveLength(1);
    expect(after.sessions?.[0].principalId).toBe(owner.principal.id);
  });

  it('denies a non-manager token with 403 and changes nothing', async () => {
    const owner = await initOwner();
    const viewer = await createPrincipal(owner.token, { name: 'Vic Viewer', role: 'viewer' });
    const second = await createPrincipal(owner.token, { name: 'Second Viewer', role: 'viewer' });
    const hashBefore = loadReady().principals.find(
      (p) => p.id === second.principal.id
    )?.tokenHash;

    const res = await rotatePOST(
      req('POST', rotateUrl(second.principal.id), viewer.token),
      ctx(second.principal.id)
    );
    expect(res.status).toBe(403);
    expect(loadReady().principals.find((p) => p.id === second.principal.id)?.tokenHash).toBe(
      hashBefore
    );
  });
});
