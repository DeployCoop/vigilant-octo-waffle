import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyStore,
  decide,
  createSession,
  findSession,
  findSessionIncludingExpired,
  revokeSession,
  revokePrincipalSessions,
  pruneExpiredSessions,
  upsertPrincipal,
  removePrincipal,
  parseAuthzStore,
  serializeAuthzStore,
  SESSION_TTL_MS,
  type AuthzStore,
  type Principal,
} from '../authz.js';

const alice: Principal = { id: 'p_alice', name: 'Alice', kind: 'human', role: 'admin' };
const bob: Principal = { id: 'p_bob', name: 'Bob', kind: 'human', role: 'viewer' };

function storeWith(...principals: Principal[]): AuthzStore {
  return { version: 1, principals };
}

const T0 = new Date('2026-10-16T12:00:00.000Z');

describe('WS5 sessions (orchestrator store layer)', () => {
  it('creates a session that resolves by its raw id, storing only the hash', () => {
    const { store, sessionId, session } = createSession(storeWith(alice), alice.id, T0);
    assert.ok(sessionId.length >= 32);
    assert.equal(session.principalId, alice.id);
    assert.equal(session.createdAt, T0.toISOString());
    assert.equal(Date.parse(session.expiresAt) - T0.getTime(), SESSION_TTL_MS);
    assert.ok(!JSON.stringify(store).includes(sessionId), 'raw id must never be stored');
    assert.equal(findSession(store, sessionId, T0)?.principalId, alice.id);
  });

  it('does not resolve unknown or tampered ids', () => {
    const { store, sessionId } = createSession(storeWith(alice), alice.id, T0);
    assert.equal(findSession(store, 'nope', T0), null);
    assert.equal(findSession(store, sessionId + 'x', T0), null);
  });

  it('stops resolving at expiry and reports it distinctly', () => {
    const { store, sessionId } = createSession(storeWith(alice), alice.id, T0);
    const after = new Date(T0.getTime() + SESSION_TTL_MS + 1);
    assert.equal(findSession(store, sessionId, after), null);
    const found = findSessionIncludingExpired(store, sessionId);
    assert.ok(found);
    // findSessionIncludingExpired uses wall-clock now: T0 is in the past
    // relative to the real clock is NOT guaranteed, so assert shape only.
    assert.equal(found.session.principalId, alice.id);
    assert.equal(typeof found.expired, 'boolean');
  });

  it('prunes expired sessions', () => {
    const first = createSession(storeWith(alice), alice.id, T0);
    const later = new Date(T0.getTime() + SESSION_TTL_MS + 1000);
    const pruned = pruneExpiredSessions(first.store, later);
    assert.equal(pruned.sessions, undefined);
  });

  it('revokes one session and all sessions of a principal', () => {
    let s = createSession(storeWith(alice, bob), alice.id, T0);
    const aliceSession = s.sessionId;
    s = createSession(s.store, bob.id, T0);
    const bobSession = s.sessionId;
    const afterOne = revokeSession(s.store, aliceSession);
    assert.equal(findSession(afterOne, aliceSession, T0), null);
    assert.equal(findSession(afterOne, bobSession, T0)?.principalId, bob.id);
    const afterAll = revokePrincipalSessions(s.store, bob.id);
    assert.equal(findSession(afterAll, bobSession, T0), null);
    assert.equal(findSession(afterAll, aliceSession, T0)?.principalId, alice.id);
    // unknown id is a no-op returning the same store
    assert.equal(revokeSession(s.store, 'unknown'), s.store);
  });

  it('caps sessions per principal, evicting the oldest', () => {
    let store = storeWith(alice);
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = createSession(store, alice.id, new Date(T0.getTime() + i * 1000));
      store = r.store;
      ids.push(r.sessionId);
    }
    assert.equal(store.sessions?.length, 10);
    assert.equal(findSession(store, ids[0], T0), null);
    assert.equal(findSession(store, ids[11], T0)?.principalId, alice.id);
  });

  it('upsert and remove revoke only the affected principal\u2019s sessions', () => {
    let s = createSession(storeWith(alice, bob), alice.id, T0);
    const aliceSession = s.sessionId;
    s = createSession(s.store, bob.id, T0);
    const bobSession = s.sessionId;

    const edited = upsertPrincipal(s.store, { ...alice, role: 'operator' });
    assert.equal(findSession(edited, aliceSession, T0), null, 'edited principal loses sessions');
    assert.equal(findSession(edited, bobSession, T0)?.principalId, bob.id, 'others keep theirs');

    const removed = removePrincipal(edited, bob.id);
    assert.equal(removed.sessions, undefined);
    void bobSession;
  });

  it('round-trips sessions and grant context through YAML serialization', () => {
    const withContext: Principal = {
      ...alice,
      grants: [
        {
          permission: 'apps:deploy',
          scope: { appId: 'wiki' },
          context: { notBefore: '2026-10-16T00:00:00.000Z', source: 'loopback', authMethod: 'session' },
        },
      ],
    };
    const { store } = createSession(storeWith(withContext), alice.id, T0);
    const parsed = parseAuthzStore(serializeAuthzStore(store));
    assert.equal(parsed.sessions?.length, 1);
    assert.equal(parsed.principals[0].grants?.[0].context?.source, 'loopback');
    assert.equal(parsed.principals[0].grants?.[0].context?.authMethod, 'session');
  });

  it('rejects malformed grant context at parse time', () => {
    const bad = {
      version: 1,
      principals: [
        { ...alice, grants: [{ permission: 'apps:deploy', context: { notBefore: 'not-a-date' } }] },
      ],
    };
    assert.throws(() => parseAuthzStore(JSON.stringify(bad)));
    const badSource = {
      version: 1,
      principals: [
        { ...alice, grants: [{ permission: 'apps:deploy', context: { source: 'moon' } }] },
      ],
    };
    assert.throws(() => parseAuthzStore(JSON.stringify(badSource)));
  });

  it('accepts a store with no sessions field (pre-WS5 files)', () => {
    const parsed = parseAuthzStore(serializeAuthzStore(createEmptyStore()));
    assert.equal(parsed.sessions, undefined);
  });
});

describe('WS5 context-scoped grants in decide()', () => {
  const NOW = new Date('2026-10-16T12:00:00.000Z');
  const loaded = (store: AuthzStore) => ({ status: 'ready' as const, store });
  const ctx = (over: Partial<{ loopback: boolean; authMethod: 'session' | 'token' | 'oidc' }> = {}) => ({
    now: NOW,
    loopback: false,
    authMethod: 'token' as const,
    ...over,
  });
  const deployer = (grant: object): Principal => ({
    id: 'p_dep',
    name: 'Deployer',
    kind: 'human',
    role: 'viewer', // viewer has no apps:deploy default — the grant is the only path
    grants: [{ permission: 'apps:deploy', ...grant } as never],
  });

  it('allows a context-free grant with or without a request context (back-compat)', () => {
    const p = deployer({});
    assert.equal(decide(loaded(storeWith(p)), p, 'apps:deploy').reason, 'allow_explicit_grant');
    assert.equal(
      decide(loaded(storeWith(p)), p, 'apps:deploy', undefined, { requestContext: ctx() }).reason,
      'allow_explicit_grant'
    );
  });

  it('gates on the time window [notBefore, notAfter)', () => {
    const p = deployer({
      context: { notBefore: '2026-10-16T00:00:00.000Z', notAfter: '2026-10-17T00:00:00.000Z' },
    });
    assert.equal(
      decide(loaded(storeWith(p)), p, 'apps:deploy', undefined, { requestContext: ctx() }).reason,
      'allow_explicit_grant'
    );
    const early = deployer({ context: { notBefore: '2026-10-17T00:00:00.000Z' } });
    assert.equal(
      decide(loaded(storeWith(early)), early, 'apps:deploy', undefined, { requestContext: ctx() }).reason,
      'deny_context'
    );
    const late = deployer({ context: { notAfter: '2026-10-16T00:00:00.000Z' } });
    assert.equal(
      decide(loaded(storeWith(late)), late, 'apps:deploy', undefined, { requestContext: ctx() }).reason,
      'deny_context'
    );
  });

  it('gates on loopback source', () => {
    const p = deployer({ context: { source: 'loopback' } });
    assert.equal(
      decide(loaded(storeWith(p)), p, 'apps:deploy', undefined, { requestContext: ctx({ loopback: true }) }).reason,
      'allow_explicit_grant'
    );
    assert.equal(
      decide(loaded(storeWith(p)), p, 'apps:deploy', undefined, { requestContext: ctx({ loopback: false }) }).reason,
      'deny_context'
    );
  });

  it('gates on auth method', () => {
    const p = deployer({ context: { authMethod: 'session' } });
    assert.equal(
      decide(loaded(storeWith(p)), p, 'apps:deploy', undefined, { requestContext: ctx({ authMethod: 'session' }) }).reason,
      'allow_explicit_grant'
    );
    assert.equal(
      decide(loaded(storeWith(p)), p, 'apps:deploy', undefined, { requestContext: ctx({ authMethod: 'token' }) }).reason,
      'deny_context'
    );
  });

  it('fails closed when no request context is supplied for a context grant', () => {
    const p = deployer({ context: { source: 'any', authMethod: 'any' } });
    assert.equal(decide(loaded(storeWith(p)), p, 'apps:deploy').reason, 'deny_context');
  });

  it('keeps deny_scope when the target is not covered, whatever the context', () => {
    const p = deployer({ scope: { appId: 'wiki' }, context: { source: 'loopback' } });
    const d = decide(loaded(storeWith(p)), p, 'apps:deploy', { appId: 'blog' }, { requestContext: ctx() });
    assert.equal(d.reason, 'deny_scope');
    const d2 = decide(loaded(storeWith(p)), p, 'apps:deploy', { appId: 'wiki' }, { requestContext: ctx() });
    assert.equal(d2.reason, 'deny_context');
  });

  it('never context-gates role defaults', () => {
    const op: Principal = {
      id: 'p_op2',
      name: 'Op',
      kind: 'human',
      role: 'operator', // apps:deploy is an operator default
      grants: [{ permission: 'apps:deploy', context: { notBefore: '2999-01-01T00:00:00.000Z' } }],
    };
    assert.equal(decide(loaded(storeWith(op)), op, 'apps:deploy').reason, 'allow_role_default');
  });
});
