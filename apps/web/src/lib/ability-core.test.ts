import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildAbility,
  abilityAllows,
  PERMISSIONS,
  type Principal,
} from '@vow/orchestrator';
import {
  abilityFromMe,
  abilityFromRules,
  subjectFor,
  endSession,
  exchangeTokenForSession,
  type MeResponse,
} from './ability-core';

const viewer: Principal = { id: 'p_v', name: 'Viewer', kind: 'human', role: 'viewer' };
const operator: Principal = { id: 'p_o', name: 'Operator', kind: 'human', role: 'operator' };
const admin: Principal = { id: 'p_a', name: 'Admin', kind: 'human', role: 'admin' };
const owner: Principal = { id: 'p_own', name: 'Owner', kind: 'human', role: 'owner' };
const scopedOperator: Principal = {
  ...operator,
  id: 'p_so',
  grants: [{ permission: 'k8s:exec', scope: { namespace: 'monitoring' } }],
};
const revokedAdmin: Principal = {
  ...admin,
  id: 'p_ra',
  revocations: ['chaos:run'],
};

const targets = [
  undefined,
  { namespace: 'monitoring' },
  { namespace: 'kube-system' },
  { appId: 'harbor' },
  { appId: 'harbor', namespace: 'monitoring' },
] as const;

describe('client ability mirrors the server ability', () => {
  // The dashboard builds its ability from the rules /api/authz/me returns
  // (buildAbility(...).rules). For every principal shape, permission, and
  // target, the client's answer must equal the server's abilityAllows().
  const principals = [viewer, operator, admin, owner, scopedOperator, revokedAdmin, null];

  for (const principal of principals) {
    it(`matches abilityAllows for ${principal?.id ?? 'anonymous'}`, () => {
      const rules = buildAbility(principal).rules as unknown as Array<Record<string, unknown>>;
      const client = abilityFromRules(rules);
      for (const permission of PERMISSIONS) {
        for (const target of targets) {
          expect(
            client.can(permission, subjectFor(target)),
            `${principal?.id} ${permission} ${JSON.stringify(target)}`
          ).toBe(abilityAllows(principal, permission, target));
        }
      }
    });
  }

  it('gives disabled principals no permissions', () => {
    const disabled: Principal = { ...owner, disabled: true };
    const client = abilityFromRules(
      buildAbility(disabled).rules as unknown as Array<Record<string, unknown>>
    );
    expect(client.can('apps:read', subjectFor())).toBe(false);
  });
});

describe('abilityFromMe', () => {
  const me = (over: Partial<MeResponse>): MeResponse => ({
    authzEnabled: true,
    principal: null,
    rules: [],
    ...over,
  });

  it('is permissive while authz is disabled', () => {
    const { status, ability } = abilityFromMe(me({ authzEnabled: false }), 200);
    expect(status).toBe('disabled');
    expect(ability.can('cluster:manage', subjectFor())).toBe(true);
  });

  it('is permissive for the local board (bootstrap mode)', () => {
    const { status, ability } = abilityFromMe(me({ localBoard: true }), 200);
    expect(status).toBe('local-board');
    expect(ability.can('users:manage_permissions', subjectFor())).toBe(true);
  });

  it('builds a rules-based ability for a principal', () => {
    const rules = buildAbility(viewer).rules as unknown as Array<Record<string, unknown>>;
    const { status, ability } = abilityFromMe(
      me({ principal: { id: 'p_v', name: 'Viewer', kind: 'human', role: 'viewer' }, rules }),
      200
    );
    expect(status).toBe('ready');
    expect(ability.can('apps:read', subjectFor())).toBe(true);
    expect(ability.can('k8s:exec', subjectFor())).toBe(false);
  });

  it('distinguishes unauthenticated from unknown-principal 401s', () => {
    const anon = abilityFromMe(null, 401);
    expect(anon.status).toBe('unauthenticated');
    expect(anon.ability.can('apps:read', subjectFor())).toBe(false);

    const unknown = abilityFromMe(
      { reason: 'deny_unknown_principal' } as MeResponse,
      401
    );
    expect(unknown.status).toBe('unknown-principal');
    expect(unknown.ability.can('apps:read', subjectFor())).toBe(false);
  });
});

describe('session exchange', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the token to the session endpoint and reports success', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(exchangeTokenForSession('vow_abc')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/authz/session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ token: 'vow_abc' });
  });

  it('reports failure on a non-OK exchange and on network errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    await expect(exchangeTokenForSession('vow_nope')).resolves.toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    await expect(exchangeTokenForSession('vow_abc')).resolves.toBe(false);
  });

  it('endSession issues a DELETE and swallows errors', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await endSession();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/authz/session');
    expect(init.method).toBe('DELETE');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    await expect(endSession()).resolves.toBeUndefined();
  });
});
