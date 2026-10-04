import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return { ...actual, loadAuthzStore: () => hoisted.load };
});

vi.mock('./project', () => ({ getProjectRoot: () => '/nonexistent-test-root' }));

import {
  generatePrincipalToken,
  hashToken,
  type AuthzStore,
  type Principal,
} from '@vow/orchestrator';
import {
  AuthzError,
  authorizeRequest,
  extractRequestToken,
  isLocalBoardRequest,
  requirePermission,
} from './authz';

const viewerToken = generatePrincipalToken();
const operatorToken = generatePrincipalToken();

const viewer: Principal = {
  id: 'p_viewer',
  name: 'Viewer',
  kind: 'human',
  role: 'viewer',
  tokenHash: hashToken(viewerToken),
};
const scopedOperator: Principal = {
  id: 'p_op',
  name: 'Scoped Operator',
  kind: 'human',
  role: 'operator',
  tokenHash: hashToken(operatorToken),
  grants: [{ permission: 'k8s:exec', scope: { namespace: 'monitoring' } }],
};

function store(...principals: Principal[]): AuthzStore {
  return { version: 1, principals };
}

function request(token?: string, headers: Record<string, string> = {}, url = 'http://localhost:3000/api/test') {
  return new Request(url, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
}

async function expectAuthzError(promise: Promise<unknown>, status: number, reason: string) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AuthzError);
    expect((err as AuthzError).status).toBe(status);
    expect((err as AuthzError).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected AuthzError ${status}/${reason} but the call succeeded`);
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
});

describe('extractRequestToken', () => {
  it('reads Bearer and x-vow-token headers', () => {
    expect(extractRequestToken(request('abc'))).toBe('abc');
    expect(extractRequestToken(request(undefined, { 'x-vow-token': 'xyz' }))).toBe('xyz');
    expect(extractRequestToken(request())).toBeNull();
  });
});

describe('isLocalBoardRequest', () => {
  it('accepts loopback hosts without forwarding headers', () => {
    expect(isLocalBoardRequest(request())).toBe(true);
    expect(isLocalBoardRequest(request(undefined, {}, 'http://127.0.0.1:3000/api'))).toBe(true);
  });

  it('rejects proxied or non-loopback requests', () => {
    expect(isLocalBoardRequest(request(undefined, { 'x-forwarded-for': '203.0.113.9' }))).toBe(false);
    expect(isLocalBoardRequest(request(undefined, {}, 'http://192.168.1.20:3000/api'))).toBe(false);
  });
});

describe('requirePermission', () => {
  it('is a no-op when authz is disabled', async () => {
    const { decision } = await requirePermission(request(), 'k8s:exec');
    expect(decision.reason).toBe('allow_authz_disabled');
  });

  it('fails closed when the store is invalid', async () => {
    hoisted.load = { status: 'invalid', error: 'bad store' };
    await expectAuthzError(requirePermission(request(), 'apps:read'), 403, 'deny_store_invalid');
  });

  it('requires authentication when the store is active', async () => {
    hoisted.load = { status: 'ready', store: store(viewer) };
    await expectAuthzError(requirePermission(request(), 'apps:read'), 401, 'deny_unauthenticated');
    await expectAuthzError(
      requirePermission(request('vow_garbage'), 'apps:read'),
      401,
      'deny_unauthenticated'
    );
  });

  it('allows role defaults and denies missing grants with 403', async () => {
    hoisted.load = { status: 'ready', store: store(viewer) };
    const { principal, decision } = await requirePermission(request(viewerToken), 'apps:read');
    expect(principal?.id).toBe('p_viewer');
    expect(decision.reason).toBe('allow_role_default');
    await expectAuthzError(requirePermission(request(viewerToken), 'k8s:exec'), 403, 'deny_missing_grant');
  });

  it('enforces scoped grants against the target', async () => {
    hoisted.load = { status: 'ready', store: store(scopedOperator) };
    const ok = await requirePermission(request(operatorToken), 'k8s:exec', { namespace: 'monitoring' });
    expect(ok.decision.reason).toBe('allow_explicit_grant');
    await expectAuthzError(
      requirePermission(request(operatorToken), 'k8s:exec', { namespace: 'kube-system' }),
      403,
      'deny_scope'
    );
    await expectAuthzError(requirePermission(request(operatorToken), 'k8s:exec'), 403, 'deny_scope');
  });

  it('bootstrap mode allows local requests only while the store is empty', async () => {
    hoisted.load = { status: 'ready', store: store() };
    const { decision } = await requirePermission(request(), 'cluster:manage');
    expect(decision.reason).toBe('allow_local_board');

    await expectAuthzError(
      requirePermission(request(undefined, { 'x-forwarded-for': '203.0.113.9' }), 'cluster:manage'),
      401,
      'deny_unauthenticated'
    );
  });
});

describe('authorizeRequest', () => {
  it('returns null when allowed and a reasoned response when denied', async () => {
    hoisted.load = { status: 'ready', store: store(viewer) };
    expect(await authorizeRequest(request(viewerToken), 'apps:read')).toBeNull();

    const denied = await authorizeRequest(request(viewerToken), 'k8s:exec');
    expect(denied?.status).toBe(403);
    const body = await denied!.json();
    expect(body.reason).toBe('deny_missing_grant');
    expect(body.error).toMatch(/permission/i);
  });
});
