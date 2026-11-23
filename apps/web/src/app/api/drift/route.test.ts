import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  scanClusterDrift: vi.fn(),
  reconcileClusterFromGit: vi.fn(),
  generateReverseCommitPatch: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    scanClusterDrift: hoisted.scanClusterDrift,
    reconcileClusterFromGit: hoisted.reconcileClusterFromGit,
    generateReverseCommitPatch: hoisted.generateReverseCommitPatch,
  };
});

import {
  generatePrincipalToken,
  hashToken,
  ClusterUnavailableError,
  type Principal,
} from '@vow/orchestrator';
import { GET, POST } from './route';

/**
 * Gate + behavior tests for /api/drift (Phase 1 wiring).
 *
 * The `reset` action is gone with the in-memory drift store: the scan
 * is stateless, so there is no remediation record to wipe. `reset` is
 * now an unknown action (400 after the argo:sync gate). Unknown drift
 * ids 404 (C8); a missing cluster 503s (F1 no-cluster contract).
 */

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

function getReq(token?: string) {
  return new Request('http://localhost:3000/api/drift', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.scanClusterDrift.mockReset();
  hoisted.reconcileClusterFromGit.mockReset();
  hoisted.generateReverseCommitPatch.mockReset();
  hoisted.scanClusterDrift.mockResolvedValue({
    totalScanned: 0,
    inSyncCount: 0,
    driftedCount: 0,
    complianceScore: 100,
    items: [],
  });
  hoisted.reconcileClusterFromGit.mockResolvedValue({ success: true, message: 'ok' });
  hoisted.generateReverseCommitPatch.mockResolvedValue({
    success: true,
    patch: '--- a/x\n+++ b/x\n',
    commitSha: 'a'.repeat(40),
    appliedResourceCount: 1,
    applied: false,
  });
});

describe('GET /api/drift (Phase 1 wiring)', () => {
  it('returns the live scan report', async () => {
    readyStore();
    const res = await GET(getReq(operatorToken));
    expect(res.status).toBe(200);
    expect(hoisted.scanClusterDrift).toHaveBeenCalled();
  });

  it('maps a missing cluster to 503 cluster_unavailable', async () => {
    readyStore();
    hoisted.scanClusterDrift.mockRejectedValue(new ClusterUnavailableError());
    const res = await GET(getReq(operatorToken));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('cluster_unavailable');
  });
});

describe('POST /api/drift gates (B6, reset removed)', () => {
  it('reset is an unknown action now: 400 after the argo:sync gate', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'reset' }, operatorToken));
    expect(res.status).toBe(400);
    expect(hoisted.reconcileClusterFromGit).not.toHaveBeenCalled();
  });

  it('keeps reconcile on argo:sync (operator passes)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'reconcile', driftId: 'd1' }, operatorToken));
    expect(res.status).toBe(200);
    expect(hoisted.reconcileClusterFromGit).toHaveBeenCalled();
  });
});

describe('POST /api/drift validation (C7) and unknown ids (C8)', () => {
  it('rejects reconcile without a driftId with 400', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'reconcile' }, operatorToken));
    expect(res.status).toBe(400);
    expect(hoisted.reconcileClusterFromGit).not.toHaveBeenCalled();
  });

  it('reconcile on an unknown drift id 404s', async () => {
    readyStore();
    hoisted.reconcileClusterFromGit.mockResolvedValue({
      success: false,
      message: 'Drift drift:nope not found.',
    });
    const res = await POST(postReq({ action: 'reconcile', driftId: 'drift:nope' }, operatorToken));
    expect(res.status).toBe(404);
  });

  it('reverse_commit on an unknown drift id 404s', async () => {
    readyStore();
    hoisted.generateReverseCommitPatch.mockResolvedValue({
      success: false,
      patch: '',
      commitSha: null,
      appliedResourceCount: 0,
      applied: false,
      message: 'Drift drift:nope not found.',
    });
    const res = await POST(
      postReq({ action: 'reverse_commit', driftId: 'drift:nope' }, operatorToken)
    );
    expect(res.status).toBe(404);
  });

  it('reverse_commit success returns the real patch payload', async () => {
    readyStore();
    const res = await POST(
      postReq({ action: 'reverse_commit', driftId: 'drift:nextcloud:deployment:nextcloud:nextcloud' }, operatorToken)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.applied).toBe(false);
    expect(body.appliedResourceCount).toBe(1);
    expect(body.commitSha).toBe('a'.repeat(40));
    expect(body.patch).toContain('--- a/x');
  });
});
