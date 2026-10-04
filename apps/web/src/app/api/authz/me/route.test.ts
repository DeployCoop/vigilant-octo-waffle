import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return { ...actual, loadAuthzStore: () => hoisted.load };
});

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET } from './route';

const viewerToken = generatePrincipalToken();
const viewer: Principal = {
  id: 'p_viewer',
  name: 'Viewer',
  kind: 'human',
  role: 'viewer',
  tokenHash: hashToken(viewerToken),
};

function request(token?: string, url = 'http://localhost:3000/api/authz/me') {
  return new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
});

describe('GET /api/authz/me', () => {
  it('reports authzEnabled=false when no store is configured', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authzEnabled).toBe(false);
    expect(data.principal).toBeNull();
  });

  it('returns the principal and packed CASL rules for a token', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer] } };
    const res = await GET(request(viewerToken));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authzEnabled).toBe(true);
    expect(data.principal).toEqual({ id: 'p_viewer', name: 'Viewer', kind: 'human', role: 'viewer' });
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.length).toBeGreaterThan(0);
    // Token hashes never leak through the API.
    expect(JSON.stringify(data)).not.toContain('sha256:');
  });

  it('401s without a token once principals exist', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer] } };
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe('deny_unauthenticated');
  });

  it('reports bootstrap local-board mode for an empty store', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [] } };
    const res = await GET(request());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.localBoard).toBe(true);
  });

  it('500s with deny_store_invalid when the store is broken', async () => {
    hoisted.load = { status: 'invalid', error: 'bad yaml' };
    const res = await GET(request(viewerToken));
    expect(res.status).toBe(500);
    expect((await res.json()).reason).toBe('deny_store_invalid');
  });
});
