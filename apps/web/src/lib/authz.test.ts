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

vi.mock('./project', () => ({ getProjectRoot: () => hoisted.root }));

import {
  generatePrincipalToken,
  hashToken,
  type AuthzStore,
  type Principal,
} from '@vow/orchestrator';
import {
  AUDIT_GENERATIONS,
  AuthzError,
  authorizeRequest,
  extractRequestToken,
  isLocalBoardRequest,
  readAuditEntries,
  requirePermission,
  resolveAuthzContext,
  rotateAuditIfNeeded,
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
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-lib-'));
  delete process.env.VOW_API_TOKEN;
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
  delete process.env.VOW_API_TOKEN;
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

describe('bootstrap owner token (VOW_API_TOKEN)', () => {
  const LEGACY = 'legacy-shared-token';

  it('resolves the legacy token to the synthetic bootstrap owner', async () => {
    process.env.VOW_API_TOKEN = LEGACY;
    hoisted.load = { status: 'ready', store: store(viewer) };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = await resolveAuthzContext(request(LEGACY));
      expect(ctx.principal?.id).toBe('bootstrap-owner');
      expect(ctx.principal?.role).toBe('owner');

      // Owner-equivalent: even permission management is allowed.
      const { decision } = await requirePermission(request(LEGACY), 'users:manage_permissions');
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('allow_owner');

      // The deprecation warning fires once, not per request.
      await resolveAuthzContext(request(LEGACY));
      expect(warn.mock.calls.flat().join(' ')).toMatch(/VOW_API_TOKEN/);
      expect(warn.mock.calls.length).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not resolve a non-matching token to the bootstrap owner', async () => {
    process.env.VOW_API_TOKEN = LEGACY;
    hoisted.load = { status: 'ready', store: store(viewer) };
    const ctx = await resolveAuthzContext(request('some-other-token'));
    expect(ctx.principal).toBeNull();
  });

  it('store principals take precedence over the bootstrap token path', async () => {
    process.env.VOW_API_TOKEN = LEGACY;
    hoisted.load = { status: 'ready', store: store(viewer) };
    const ctx = await resolveAuthzContext(request(viewerToken));
    expect(ctx.principal?.id).toBe('p_viewer');
  });
});

describe('audit logging', () => {
  it('records denials with principal, permission, reason, and route', async () => {
    hoisted.load = { status: 'ready', store: store(viewer) };
    await authorizeRequest(request(viewerToken), 'k8s:exec');

    const entries = readAuditEntries(hoisted.root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      principalId: 'p_viewer',
      permission: 'k8s:exec',
      allowed: false,
      reason: 'deny_missing_grant',
      route: '/api/test',
    });
    expect(typeof entries[0].ts).toBe('string');
  });

  it('records allowed decisions for mutating permissions', async () => {
    hoisted.load = { status: 'ready', store: store(scopedOperator) };
    await authorizeRequest(request(operatorToken), 'k8s:exec', { namespace: 'monitoring' });

    const entries = readAuditEntries(hoisted.root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      permission: 'k8s:exec',
      allowed: true,
      target: { namespace: 'monitoring' },
    });
  });

  it('does not record allowed reads or anything while authz is disabled', async () => {
    hoisted.load = { status: 'ready', store: store(viewer) };
    await authorizeRequest(request(viewerToken), 'apps:read');
    expect(readAuditEntries(hoisted.root)).toEqual([]);

    hoisted.load = { status: 'disabled' };
    await authorizeRequest(request(), 'cluster:manage');
    expect(fs.existsSync(path.join(hoisted.root, '.vow', 'audit.log'))).toBe(false);
  });

  it('returns entries newest-first and honors the limit', async () => {
    hoisted.load = { status: 'ready', store: store(viewer) };
    await authorizeRequest(request(viewerToken), 'k8s:exec');
    await authorizeRequest(request(viewerToken), 'cluster:manage');
    await authorizeRequest(request(viewerToken), 'chaos:run');

    const all = readAuditEntries(hoisted.root);
    expect(all.map((e) => e.permission)).toEqual(['chaos:run', 'cluster:manage', 'k8s:exec']);
    expect(readAuditEntries(hoisted.root, 2).map((e) => e.permission)).toEqual([
      'chaos:run',
      'cluster:manage',
    ]);
  });

  describe('rotation', () => {
    const auditFile = () => path.join(hoisted.root, '.vow', 'audit.log');

    it('rotateAuditIfNeeded shifts generations and drops the oldest', () => {
      const file = auditFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'current\n');
      fs.writeFileSync(`${file}.1`, 'gen1\n');
      fs.writeFileSync(`${file}.2`, 'gen2\n');
      fs.writeFileSync(`${file}.3`, 'gen3\n');

      rotateAuditIfNeeded(file, 100, 10); // 8 bytes present + 100 > cap 10

      expect(fs.readFileSync(`${file}.1`, 'utf-8')).toBe('current\n');
      expect(fs.readFileSync(`${file}.2`, 'utf-8')).toBe('gen1\n');
      expect(fs.readFileSync(`${file}.3`, 'utf-8')).toBe('gen2\n');
      expect(fs.existsSync(file)).toBe(false); // moved to .1
      expect(fs.existsSync(`${file}.${AUDIT_GENERATIONS + 1}`)).toBe(false);
    });

    it('rotateAuditIfNeeded is a no-op under the cap and without a file', () => {
      const file = auditFile();
      rotateAuditIfNeeded(file, 100, 10); // no file — must not throw
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'tiny\n');
      rotateAuditIfNeeded(file, 1, 1024);
      expect(fs.readFileSync(file, 'utf-8')).toBe('tiny\n');
      expect(fs.existsSync(`${file}.1`)).toBe(false);
    });

    it('recordAudit rotates at the env-configured cap and reads span generations', async () => {
      const prev = process.env.VOW_AUDIT_MAX_BYTES;
      process.env.VOW_AUDIT_MAX_BYTES = '260'; // each denial entry is ~200 bytes
      try {
        hoisted.load = { status: 'ready', store: store(viewer) };
        for (let i = 0; i < 6; i++) {
          await authorizeRequest(request(viewerToken), 'k8s:exec');
        }
      } finally {
        if (prev === undefined) delete process.env.VOW_AUDIT_MAX_BYTES;
        else process.env.VOW_AUDIT_MAX_BYTES = prev;
      }

      // Rotation happened, generations are bounded, active file is small.
      expect(fs.existsSync(`${auditFile()}.1`)).toBe(true);
      expect(fs.existsSync(`${auditFile()}.${AUDIT_GENERATIONS + 1}`)).toBe(false);
      expect(fs.statSync(auditFile()).size).toBeLessThanOrEqual(260 + 260);

      // The reader still sees recent history across the boundary.
      const entries = readAuditEntries(hoisted.root);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries.every((e) => e.permission === 'k8s:exec')).toBe(true);
    });
  });
});
