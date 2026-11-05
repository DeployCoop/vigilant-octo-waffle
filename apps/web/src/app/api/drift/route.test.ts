import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  scanClusterDrift: vi.fn(),
  reconcileClusterFromGit: vi.fn(),
  resetDriftStore: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    scanClusterDrift: hoisted.scanClusterDrift,
    reconcileClusterFromGit: hoisted.reconcileClusterFromGit,
    resetDriftStore: hoisted.resetDriftStore,
  };
});

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { POST } from './route';

/** Gate tests for /api/drift POST (bug hunt B6). */

const operatorToken = generatePrincipalToken();
const ownerToken = generatePrincipalToken();

const operator: Principal = {
  id: 'p_op', name: 'Oscar Operator', kind: 'human', role: 'operator',
  tokenHash: hashToken(operatorToken),
};
const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};

function readyStore() {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [operator, owner] } };
}

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/drift', {
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
  hoisted.scanClusterDrift.mockReset();
  hoisted.reconcileClusterFromGit.mockReset();
  hoisted.resetDriftStore.mockReset();
  hoisted.scanClusterDrift.mockResolvedValue({ drifts: [] });
  hoisted.reconcileClusterFromGit.mockResolvedValue({ success: true });
});

describe('POST /api/drift gates (B6)', () => {
  it('denies reset to an operator even without a driftId (cluster:manage gate first)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'reset' }, operatorToken));
    expect(res.status).toBe(403);
    expect(hoisted.resetDriftStore).not.toHaveBeenCalled();
  });

  it('allows reset to the owner', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'reset' }, ownerToken));
    expect(res.status).toBe(200);
    expect(hoisted.resetDriftStore).toHaveBeenCalled();
  });

  it('keeps reconcile on argo:sync (operator passes)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'reconcile', driftId: 'd1' }, operatorToken));
    expect(res.status).toBe(200);
    expect(hoisted.reconcileClusterFromGit).toHaveBeenCalled();
  });
});
