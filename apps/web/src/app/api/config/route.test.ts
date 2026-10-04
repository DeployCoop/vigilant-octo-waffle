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
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    loadProjectConfig: () => ({
      raw: {
        THIS_DOMAIN: 'waffle.local',
        DB_PASSWORD: 'hunter2',
        API_TOKEN: 'tok_live_123',
      },
      cluster: { domain: 'waffle.local', name: 'kind-waffle' },
      enablers: {},
    }),
    saveEnvFile: vi.fn(),
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import {
  generatePrincipalToken,
  hashToken,
  type AuthzStore,
  type Principal,
} from '@vow/orchestrator';
import { GET, POST } from './route';

const viewerToken = generatePrincipalToken();
const adminToken = generatePrincipalToken();

const viewer: Principal = {
  id: 'p_viewer',
  name: 'Viewer',
  kind: 'human',
  role: 'viewer',
  tokenHash: hashToken(viewerToken),
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

function get(token?: string) {
  return new Request('http://localhost:3000/api/config', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-config-route-'));
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('GET /api/config redaction split', () => {
  it('returns raw values when authz is disabled', async () => {
    const res = await GET(get());
    const body = await res.json();
    expect(body.config.DB_PASSWORD).toBe('hunter2');
  });

  it('redacts secrets for principals without secrets:read', async () => {
    hoisted.load = { status: 'ready', store: store(viewer, admin) };
    const res = await GET(get(viewerToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.DB_PASSWORD).toBe('[redacted]');
    expect(body.config.API_TOKEN).toBe('[redacted]');
    // Non-secret config stays visible.
    expect(body.config.THIS_DOMAIN).toBe('waffle.local');
    expect(body.cluster.domain).toBe('waffle.local');
  });

  it('returns raw values for principals with secrets:read', async () => {
    hoisted.load = { status: 'ready', store: store(viewer, admin) };
    const res = await GET(get(adminToken));
    const body = await res.json();
    expect(body.config.DB_PASSWORD).toBe('hunter2');
    expect(body.config.API_TOKEN).toBe('tok_live_123');
  });

  it('denies unauthenticated callers when authz is on', async () => {
    hoisted.load = { status: 'ready', store: store(viewer, admin) };
    const res = await GET(get());
    // Loopback bootstrap only applies while the store is empty; with
    // principals provisioned an anonymous caller is rejected.
    expect(res.status).toBe(401);
  });
});

describe('POST /api/config guard', () => {
  it('rejects viewers (no config:update) and allows admins', async () => {
    hoisted.load = { status: 'ready', store: store(viewer, admin) };
    const post = (token: string) =>
      new Request('http://localhost:3000/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ updates: { THIS_DOMAIN: 'new.local' } }),
      });

    const denied = await POST(post(viewerToken));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.reason).toBe('deny_missing_grant');

    const ok = await POST(post(adminToken));
    expect(ok.status).toBe(200);
    expect((await ok.json()).success).toBe(true);
  });
});
