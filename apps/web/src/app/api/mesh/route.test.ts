import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  enforceStrictMtls: vi.fn(),
  getMeshStatus: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    enforceStrictMtls: hoisted.enforceStrictMtls,
    getMeshStatus: hoisted.getMeshStatus,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET, POST } from './route';

/** Gate tests for /api/mesh (bug hunt B3). */

const viewerToken = generatePrincipalToken();
const ownerToken = generatePrincipalToken();

const viewer: Principal = {
  id: 'p_view', name: 'Vic Viewer', kind: 'human', role: 'viewer',
  tokenHash: hashToken(viewerToken),
};
const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};

function readyStore() {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer, owner] } };
}

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/mesh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-mesh-'));
  hoisted.enforceStrictMtls.mockReset();
  hoisted.getMeshStatus.mockReset();
  hoisted.enforceStrictMtls.mockReturnValue({ applied: true });
  hoisted.getMeshStatus.mockReturnValue({ mode: 'STRICT' });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/mesh gates (B3)', () => {
  it('denies enforcement to a viewer (security:read is not enough)', async () => {
    readyStore();
    const res = await POST(postReq({ namespace: 'default' }, viewerToken));
    expect(res.status).toBe(403);
    expect(hoisted.enforceStrictMtls).not.toHaveBeenCalled();
  });

  it('allows enforcement to the owner (security:manage)', async () => {
    readyStore();
    const res = await POST(postReq({ namespace: 'default' }, ownerToken));
    expect(res.status).toBe(200);
    expect(hoisted.enforceStrictMtls).toHaveBeenCalled();
  });

  it('keeps GET on security:read (viewer passes)', async () => {
    readyStore();
    const res = await GET(new Request('http://localhost:3000/api/mesh', {
      headers: { authorization: `Bearer ${viewerToken}` },
    }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/mesh validation (C7)', () => {
  it('rejects a non-label namespace with 400', async () => {
    readyStore();
    const res = await POST(postReq({ namespace: 'Bad_Ns' }, ownerToken));
    expect(res.status).toBe(400);
    expect(hoisted.enforceStrictMtls).not.toHaveBeenCalled();
  });
});
