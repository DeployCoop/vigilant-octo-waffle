import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  listFleetClusters: vi.fn(),
  switchClusterContext: vi.fn(),
  broadcastApplication: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    listFleetClusters: hoisted.listFleetClusters,
    switchClusterContext: hoisted.switchClusterContext,
    broadcastApplication: hoisted.broadcastApplication,
  };
});

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET, POST } from './route';

/** Fleet route contract (studio wiring, Phase 1): 503 on no-cluster, 200 with per-cluster outcomes on partial failure, 404 only on no match. */

const viewerToken = generatePrincipalToken();
const ownerToken = generatePrincipalToken();
const operatorToken = generatePrincipalToken();

const viewer: Principal = {
  id: 'p_viewer', name: 'Vera Viewer', kind: 'human', role: 'viewer',
  tokenHash: hashToken(viewerToken),
};
const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};
const operator: Principal = {
  id: 'p_op', name: 'Oscar Operator', kind: 'human', role: 'operator',
  tokenHash: hashToken(operatorToken),
};

function readyStore() {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer, owner, operator] } };
}

function getReq(token?: string) {
  return new Request('http://localhost:3000/api/fleet', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/fleet', {
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
  hoisted.listFleetClusters.mockReset();
  hoisted.switchClusterContext.mockReset();
  hoisted.broadcastApplication.mockReset();
});

describe('GET /api/fleet', () => {
  it('returns clusters to a viewer (cluster:read)', async () => {
    readyStore();
    hoisted.listFleetClusters.mockResolvedValue([{ id: 'kind-local' }]);
    const res = await GET(getReq(viewerToken));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clusters: [{ id: 'kind-local' }] });
  });

  it('maps ClusterUnavailableError to 503 cluster_unavailable', async () => {
    readyStore();
    const { ClusterUnavailableError } = await import('@vow/orchestrator');
    hoisted.listFleetClusters.mockRejectedValue(
      new ClusterUnavailableError('No Kubernetes contexts are configured')
    );
    const res = await GET(getReq(viewerToken));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('cluster_unavailable');
  });
});

describe('POST /api/fleet', () => {
  it('denies broadcast to an operator (no cluster:manage)', async () => {
    readyStore();
    const res = await POST(
      postReq({ action: 'broadcast', appId: 'nextcloud', targetClusterIds: ['kind-local'] }, operatorToken)
    );
    expect(res.status).toBe(403);
    expect(hoisted.broadcastApplication).not.toHaveBeenCalled();
  });

  it('returns 200 with per-cluster outcomes on partial failure, not 404', async () => {
    readyStore();
    hoisted.broadcastApplication.mockResolvedValue({
      success: false,
      deployedClusters: ['local'],
      failedClusters: ['edge'],
      results: [
        { clusterId: 'kind-local', clusterName: 'local', success: true, message: 'Synced nextcloud via argocd.' },
        { clusterId: 'k3d-edge', clusterName: 'edge', success: false, message: 'argocd sync failed (exit 1, task task_x).' },
      ],
      message: 'Broadcast of [nextcloud] partially failed: 1 synced, 1 failed (edge).',
    });
    const res = await POST(
      postReq({ action: 'broadcast', appId: 'nextcloud', targetClusterIds: ['kind-local', 'k3d-edge'] }, ownerToken)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.results).toHaveLength(2);
    expect(body.failedClusters).toEqual(['edge']);
    expect(hoisted.broadcastApplication).toHaveBeenCalledWith(
      'nextcloud',
      ['kind-local', 'k3d-edge'],
      { projectRoot: expect.any(String) }
    );
  });

  it('returns 404 only when no target matches', async () => {
    readyStore();
    hoisted.broadcastApplication.mockResolvedValue({
      success: false,
      deployedClusters: [],
      failedClusters: [],
      results: [],
      message: 'No matching fleet clusters found for broadcast of application [nope].',
    });
    const res = await POST(
      postReq({ action: 'broadcast', appId: 'nope', targetClusterIds: ['no-such-cluster'] }, ownerToken)
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown switch target', async () => {
    readyStore();
    hoisted.switchClusterContext.mockResolvedValue({
      success: false,
      activeCluster: null,
      message: 'Cluster no-such-cluster not found.',
    });
    const res = await POST(
      postReq({ action: 'switch_context', clusterId: 'no-such-cluster' }, ownerToken)
    );
    expect(res.status).toBe(404);
  });

  it('maps ClusterUnavailableError to 503 on POST', async () => {
    readyStore();
    const { ClusterUnavailableError } = await import('@vow/orchestrator');
    hoisted.broadcastApplication.mockRejectedValue(
      new ClusterUnavailableError('No Kubernetes contexts are configured')
    );
    const res = await POST(
      postReq({ action: 'broadcast', appId: 'nextcloud', targetClusterIds: ['kind-local'] }, ownerToken)
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('cluster_unavailable');
  });
});
