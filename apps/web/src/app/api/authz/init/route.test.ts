import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({ root: '' }));

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { POST as initPOST } from './route';
import { GET, POST } from '../principals/route';
import { loadAuthzStore, MIN_PASSWORD_LENGTH } from '@vow/orchestrator';

/**
 * Behavior tests for POST /api/authz/init (Plan III §5.1 tranche 1).
 * The collection suite (../principals/route.test.ts) already pins the
 * generated-token bootstrap and the second-init 409 for an owner; this
 * file pins what it does not: the 12-character floor for self-chosen
 * credentials, the custom-password (scrypt) path, the local-board-only
 * bootstrap rule, and that the management gate fires before the 409
 * for non-owners once a store exists.
 */

function req(body?: unknown, headers: Record<string, string> = {}, token?: string) {
  return new Request('http://localhost:3000/api/authz/init', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-init-'));
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/authz/init — credential floor (Plan III §5.1)', () => {
  it(`rejects a self-chosen password shorter than ${12} characters with a 400`, async () => {
    const res = await initPOST(req({ name: 'Owner', password: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.reason).toBe('password_too_short');
    // Nothing was initialized.
    expect(loadAuthzStore(hoisted.root).status).toBe('disabled');
  });

  it('applies the same floor to the token field', async () => {
    const res = await initPOST(req({ name: 'Owner', token: 'tiny' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.reason).toBe('password_too_short');
    expect(loadAuthzStore(hoisted.root).status).toBe('disabled');
  });

  it('accepts a custom password at the floor, stores it as scrypt, and it authenticates', async () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    const password = 'correct horse battery staple';
    const res = await initPOST(req({ name: 'Olivia Owner', password }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.isCustomPassword).toBe(true);
    // The chosen password IS the returned credential.
    expect(data.token).toBe(password);

    const raw = fs.readFileSync(path.join(hoisted.root, '.vow', 'authz.yaml'), 'utf-8');
    expect(raw).toContain('scrypt:');
    expect(raw).not.toContain(password);

    // And it resolves as the owner.
    const list = await GET(
      new Request('http://localhost:3000/api/authz/principals', {
        headers: { authorization: `Bearer ${password}` },
      })
    );
    expect(list.status).toBe(200);
  });
});

describe('POST /api/authz/init — bootstrap reachability', () => {
  it('refuses a non-local first bootstrap with 403 and writes no store', async () => {
    // A proxied/forwarded request is never the local board.
    const res = await initPOST(req({ name: 'Remote Attacker' }, { 'x-forwarded-for': '198.51.100.7' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe('bootstrap_requires_local_board');
    expect(loadAuthzStore(hoisted.root).status).toBe('disabled');
    expect(fs.existsSync(path.join(hoisted.root, '.vow', 'authz.yaml'))).toBe(false);
  });

  it('denies a non-owner caller with 403 once a store exists (gate before the 409)', async () => {
    const init = await initPOST(req({ name: 'Olivia Owner' }));
    expect(init.status).toBe(201);
    const { token: ownerToken } = await init.json();

    const created = await POST(
      new Request('http://localhost:3000/api/authz/principals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ name: 'Vic Viewer', role: 'viewer' }),
      })
    );
    expect(created.status).toBe(201);
    const { token: viewerToken } = await created.json();

    const res = await initPOST(req({ name: 'Second' }, {}, viewerToken));
    expect(res.status).toBe(403);
  });
});
