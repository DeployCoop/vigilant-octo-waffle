import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  saved: [] as import('@vow/orchestrator').AuthzStore[],
  events: [] as string[],
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    saveAuthzStore: (_root: string, store: import('@vow/orchestrator').AuthzStore) => {
      hoisted.saved.push(store);
    },
  };
});

vi.mock('@/lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authz')>();
  return {
    ...actual,
    recordAuthEvent: (_req: Request, event: string) => {
      hoisted.events.push(event);
    },
  };
});

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { POST, DELETE } from './route';

const aliceToken = generatePrincipalToken();
const alice: Principal = {
  id: 'p_alice',
  name: 'Alice',
  kind: 'human',
  role: 'admin',
  tokenHash: hashToken(aliceToken),
};
const disabledDave: Principal = {
  id: 'p_dave',
  name: 'Dave',
  kind: 'human',
  role: 'viewer',
  tokenHash: hashToken('dave-token'),
  disabled: true,
};

function post(token?: string) {
  return new Request('http://localhost:3000/api/authz/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(token ? { token } : {}),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [alice, disabledDave] } };
  hoisted.saved = [];
  hoisted.events = [];
});

describe('/api/authz/session', () => {
  it('exchanges a valid token for an httpOnly session cookie and stores only the hash', async () => {
    const res = await POST(post(aliceToken));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('vow_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie.toLowerCase()).toContain('samesite=strict');
    const rawId = /vow_session=([^;]+)/.exec(setCookie)?.[1];
    expect(rawId).toBeTruthy();
    expect(hoisted.saved).toHaveLength(1);
    const stored = hoisted.saved[0];
    expect(stored.sessions).toHaveLength(1);
    expect(stored.sessions?.[0].principalId).toBe('p_alice');
    expect(JSON.stringify(stored)).not.toContain(rawId);
    expect(hoisted.events).toContain('session_created');
    const body = await res.json();
    expect(body.principal.id).toBe('p_alice');
    expect(JSON.stringify(body)).not.toContain('tokenHash');
  });

  it('rejects an unknown token without setting a cookie', async () => {
    const res = await POST(post('vow_bogus'));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(hoisted.saved).toHaveLength(0);
  });

  it('rejects a disabled principal', async () => {
    const res = await POST(post('dave-token'));
    expect(res.status).toBe(403);
    expect(hoisted.saved).toHaveLength(0);
  });

  it('returns 409 when authz is not enabled', async () => {
    hoisted.load = { status: 'disabled' };
    const res = await POST(post(aliceToken));
    expect(res.status).toBe(409);
  });

  it('DELETE revokes the presented session and clears the cookie', async () => {
    const created = await POST(post(aliceToken));
    const rawId = /vow_session=([^;]+)/.exec(created.headers.get('set-cookie') ?? '')?.[1];
    expect(rawId).toBeTruthy();
    hoisted.load = { status: 'ready', store: hoisted.saved[0] };
    hoisted.saved = [];
    const res = await DELETE(
      new Request('http://localhost:3000/api/authz/session', {
        method: 'DELETE',
        headers: { cookie: `vow_session=${rawId}` },
      })
    );
    expect(res.status).toBe(200);
    expect(hoisted.saved).toHaveLength(1);
    expect(hoisted.saved[0].sessions ?? []).toHaveLength(0);
    expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
    expect(hoisted.events).toContain('session_revoked');
  });
});
