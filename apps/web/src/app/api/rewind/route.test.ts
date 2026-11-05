import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  compareSnapshotWithLive: vi.fn(),
  rewindToSnapshot: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    compareSnapshotWithLive: hoisted.compareSnapshotWithLive,
    rewindToSnapshot: hoisted.rewindToSnapshot,
  };
});

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { POST } from './route';

/** Gate tests for /api/rewind POST (bug hunt B6). */

const viewerToken = generatePrincipalToken();
const operatorToken = generatePrincipalToken();
const ownerToken = generatePrincipalToken();

const viewer: Principal = {
  id: 'p_view', name: 'Vic Viewer', kind: 'human', role: 'viewer',
  tokenHash: hashToken(viewerToken),
};
const operator: Principal = {
  id: 'p_op', name: 'Oscar Operator', kind: 'human', role: 'operator',
  tokenHash: hashToken(operatorToken),
};
const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};

function readyStore() {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer, operator, owner] } };
}

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/rewind', {
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
  hoisted.compareSnapshotWithLive.mockReset();
  hoisted.rewindToSnapshot.mockReset();
  hoisted.compareSnapshotWithLive.mockResolvedValue({ diffs: [] });
  hoisted.rewindToSnapshot.mockResolvedValue({ success: true });
});

describe('POST /api/rewind gates (B6)', () => {
  it('keeps compare on cluster:read (viewer passes)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'compare', snapshotId: 's1' }, viewerToken));
    expect(res.status).toBe(200);
    expect(hoisted.compareSnapshotWithLive).toHaveBeenCalled();
  });

  it('denies rewind to an operator (no cluster:manage)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'rewind', snapshotId: 's1' }, operatorToken));
    expect(res.status).toBe(403);
    expect(hoisted.rewindToSnapshot).not.toHaveBeenCalled();
  });

  it('allows rewind to the owner (cluster:manage)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'rewind', snapshotId: 's1' }, ownerToken));
    expect(res.status).toBe(200);
    expect(hoisted.rewindToSnapshot).toHaveBeenCalled();
  });
});
