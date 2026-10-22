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

import {
  createSession,
  generatePrincipalToken,
  hashToken,
  type AuthzStore,
  type Principal,
} from '@vow/orchestrator';
import { POST, GET, DELETE } from './route';

const aliceToken = generatePrincipalToken();
const alice: Principal = {
  id: 'p_alice',
  name: 'Alice',
  kind: 'human',
  role: 'admin',
  tokenHash: hashToken(aliceToken),
};
const bobToken = generatePrincipalToken();
const bob: Principal = {
  id: 'p_bob',
  name: 'Bob',
  kind: 'human',
  role: 'viewer',
  tokenHash: hashToken(bobToken),
};
const olgaToken = generatePrincipalToken();
const olga: Principal = {
  id: 'p_olga',
  name: 'Olga',
  kind: 'human',
  role: 'owner',
  tokenHash: hashToken(olgaToken),
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

  describe('GET (Plan III §4.3)', () => {
    /** Principals alice/bob/olga; live sessions for alice + bob, one expired for alice. */
    function seededStore(): AuthzStore {
      let store: AuthzStore = { version: 1, principals: [alice, bob, olga] };
      const now = new Date();
      store = createSession(store, 'p_alice', now).store;
      store = createSession(store, 'p_bob', now).store;
      store = createSession(store, 'p_alice', new Date(now.getTime() - 13 * 3600_000)).store;
      return store;
    }

    function getReq(headers: Record<string, string> = {}) {
      return new Request('http://localhost:3000/api/authz/session', {
        method: 'GET',
        headers,
      });
    }

    beforeEach(() => {
      hoisted.load = { status: 'ready', store: seededStore() };
    });

    it('rejects unauthenticated callers with 401', async () => {
      const res = await GET(getReq());
      expect(res.status).toBe(401);
    });

    it('shows a non-manager only their own live sessions', async () => {
      const res = await GET(getReq({ authorization: `Bearer ${bobToken}` }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].principalId).toBe('p_bob');
      expect(body.sessions[0].idHashPrefix).toHaveLength(16);
      expect(body.sessions[0].createdAt).toBeTruthy();
      expect(body.sessions[0].expiresAt).toBeTruthy();
      // The full stored hash is never exposed — only its prefix.
      const stored = (hoisted.load as { store: AuthzStore }).store;
      const bobHash = stored.sessions?.find((s) => s.principalId === 'p_bob')?.idHash ?? '';
      expect(bobHash.length).toBeGreaterThan(16);
      expect(JSON.stringify(body)).not.toContain(bobHash);
      expect(body.sessions[0].idHashPrefix).toBe(bobHash.slice(0, 16));
    });

    it('shows a principals manager every live session, expired excluded', async () => {
      const res = await GET(getReq({ authorization: `Bearer ${olgaToken}` }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toHaveLength(2);
      expect(body.sessions.map((s: { principalId: string }) => s.principalId).sort()).toEqual([
        'p_alice',
        'p_bob',
      ]);
    });

    it('resolves the caller from the session cookie', async () => {
      hoisted.load = { status: 'ready', store: { version: 1, principals: [alice, bob, olga] } };
      const created = await POST(post(aliceToken));
      const rawId = /vow_session=([^;]+)/.exec(created.headers.get('set-cookie') ?? '')?.[1];
      hoisted.load = { status: 'ready', store: hoisted.saved[0] };
      const res = await GET(getReq({ cookie: `vow_session=${rawId}` }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].principalId).toBe('p_alice');
    });
  });

  describe('DELETE with a target (Plan III §4.3)', () => {
    function seededStore(): AuthzStore {
      let store: AuthzStore = { version: 1, principals: [alice, bob, olga] };
      const now = new Date();
      store = createSession(store, 'p_alice', now).store;
      store = createSession(store, 'p_bob', now).store;
      return store;
    }

    function deleteReq(body: unknown, headers: Record<string, string> = {}) {
      return new Request('http://localhost:3000/api/authz/session', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    }

    beforeEach(() => {
      hoisted.load = { status: 'ready', store: seededStore() };
    });

    it('lets a caller revoke all of their own sessions by principalId', async () => {
      const res = await DELETE(
        deleteReq({ principalId: 'p_bob' }, { authorization: `Bearer ${bobToken}` })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, revoked: 1 });
      expect(hoisted.saved).toHaveLength(1);
      const remaining = hoisted.saved[0].sessions ?? [];
      expect(remaining).toHaveLength(1);
      expect(remaining[0].principalId).toBe('p_alice');
      expect(hoisted.events).toContain('session_revoked');
    });

    it('forbids revoking another principal’s sessions without the manage permission', async () => {
      const res = await DELETE(
        deleteReq({ principalId: 'p_alice' }, { authorization: `Bearer ${bobToken}` })
      );
      expect(res.status).toBe(403);
      expect(hoisted.saved).toHaveLength(0);
    });

    it('lets a principals manager revoke another principal’s sessions', async () => {
      const res = await DELETE(
        deleteReq({ principalId: 'p_alice' }, { authorization: `Bearer ${olgaToken}` })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, revoked: 1 });
      expect(hoisted.saved[0].sessions?.map((s) => s.principalId)).toEqual(['p_bob']);
    });

    it('returns 404 for an unknown principalId', async () => {
      const res = await DELETE(
        deleteReq({ principalId: 'p_nobody' }, { authorization: `Bearer ${olgaToken}` })
      );
      expect(res.status).toBe(404);
      expect(hoisted.saved).toHaveLength(0);
    });

    it('revokes one session by id hash prefix', async () => {
      const stored = (hoisted.load as { store: AuthzStore }).store;
      const bobHash = stored.sessions?.find((s) => s.principalId === 'p_bob')?.idHash ?? '';
      const res = await DELETE(
        deleteReq({ idHashPrefix: bobHash.slice(0, 16) }, { authorization: `Bearer ${bobToken}` })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, revoked: 1 });
      expect(hoisted.saved[0].sessions?.map((s) => s.principalId)).toEqual(['p_alice']);
      expect(hoisted.events).toContain('session_revoked');
    });

    it('forbids revoking another principal’s session by prefix', async () => {
      const stored = (hoisted.load as { store: AuthzStore }).store;
      const aliceHash = stored.sessions?.find((s) => s.principalId === 'p_alice')?.idHash ?? '';
      const res = await DELETE(
        deleteReq({ idHashPrefix: aliceHash.slice(0, 16) }, { authorization: `Bearer ${bobToken}` })
      );
      expect(res.status).toBe(403);
      expect(hoisted.saved).toHaveLength(0);
    });

    it('rejects a too-short id hash prefix with 400', async () => {
      const res = await DELETE(
        deleteReq({ idHashPrefix: 'sha256:ab' }, { authorization: `Bearer ${olgaToken}` })
      );
      expect(res.status).toBe(400);
      expect(hoisted.saved).toHaveLength(0);
    });

    it('rejects an unauthenticated targeted revoke with 401', async () => {
      const res = await DELETE(deleteReq({ principalId: 'p_bob' }));
      expect(res.status).toBe(401);
      expect(hoisted.saved).toHaveLength(0);
    });
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
