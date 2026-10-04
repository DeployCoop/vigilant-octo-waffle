import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return { ...actual, loadAuthzStore: () => hoisted.load };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import {
  generatePrincipalToken,
  hashToken,
  type AuthzStore,
  type Principal,
} from '@vow/orchestrator';
import { GET } from './route';
import { authorizeRequest } from '@/lib/authz';

const ownerToken = generatePrincipalToken();
const adminToken = generatePrincipalToken();

const owner: Principal = {
  id: 'p_owner',
  name: 'Owner',
  kind: 'human',
  role: 'owner',
  tokenHash: hashToken(ownerToken),
};
const admin: Principal = {
  id: 'p_admin',
  name: 'Admin',
  kind: 'human',
  role: 'admin',
  tokenHash: hashToken(adminToken),
};

function store(...principals: Principal[]): AuthzStore {
  return { version: 1, principals };
}

function get(token?: string, url = 'http://localhost:3000/api/authz/audit') {
  return new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-audit-route-'));
  hoisted.load = { status: 'ready', store: store(owner, admin) };
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('GET /api/authz/audit', () => {
  it('is restricted to users:manage_permissions (owner only, not admin)', async () => {
    const denied = await GET(get(adminToken));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.reason).toBe('deny_missing_grant');
  });

  it('contains only the caller’s own access when nothing else was audited', async () => {
    const res = await GET(get(ownerToken));
    expect(res.status).toBe(200);
    const entries = (await res.json()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      principalId: 'p_owner',
      permission: 'users:manage_permissions',
      allowed: true,
    });
  });

  it('returns recorded decisions newest-first', async () => {
    // Generate two audited decisions through the real guard path.
    await authorizeRequest(get(adminToken), 'cluster:manage');
    await authorizeRequest(get(adminToken), 'chaos:run');

    const res = await GET(get(ownerToken));
    const body = await res.json();
    // The owner's own audit read is itself an audited decision and lands
    // first; the two generated decisions follow, newest first.
    expect(body.entries.map((e: { permission: string }) => e.permission)).toEqual([
      'users:manage_permissions',
      'chaos:run',
      'cluster:manage',
    ]);
    expect(body.entries[1]).toMatchObject({ principalId: 'p_admin', allowed: true });
  });
});
