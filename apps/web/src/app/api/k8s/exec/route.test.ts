import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  createSession: vi.fn(() => ({ id: 'session-1' })),
  root: '',
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    execSessionManager: {
      createSession: hoisted.createSession,
      getSession: vi.fn(() => null),
      closeSession: vi.fn(),
    },
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { POST, GET } from './route';

const operatorToken = generatePrincipalToken();
const scoped: Principal = {
  id: 'p_op',
  name: 'Scoped Operator',
  kind: 'human',
  role: 'operator',
  tokenHash: hashToken(operatorToken),
  grants: [{ permission: 'k8s:exec', scope: { namespace: 'monitoring' } }],
};

function post(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/k8s/exec', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const startBody = { action: 'start', namespace: 'monitoring', podName: 'web-0' };

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.createSession.mockClear();
  // Audit entries from guard decisions land in a throwaway root.
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-exec-route-'));
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/k8s/exec guard', () => {
  it('works unchanged while authz is disabled', async () => {
    const res = await POST(post(startBody));
    expect(res.status).toBe(200);
    expect(hoisted.createSession).toHaveBeenCalledTimes(1);
    expect((await res.json()).sessionId).toBe('session-1');
  });

  it('rejects unauthenticated callers once a store exists', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [scoped] } };
    const res = await POST(post(startBody));
    expect(res.status).toBe(401);
    expect((await res.json()).error.reason).toBe('deny_unauthenticated');
    expect(hoisted.createSession).not.toHaveBeenCalled();
  });

  it('honors the namespace-scoped exec grant', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [scoped] } };
    const ok = await POST(post(startBody, operatorToken));
    expect(ok.status).toBe(200);
    expect(hoisted.createSession).toHaveBeenCalledTimes(1);

    const outOfScope = await POST(
      post({ action: 'start', namespace: 'kube-system', podName: 'coredns-0' }, operatorToken)
    );
    expect(outOfScope.status).toBe(403);
    expect((await outOfScope.json()).error.reason).toBe('deny_scope');
  });

  it('guards the output stream as well', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [scoped] } };
    const res = await GET(new Request('http://localhost:3000/api/k8s/exec?sessionId=session-1'));
    expect(res.status).toBe(401);
  });
});
