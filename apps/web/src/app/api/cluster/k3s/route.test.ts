import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  getK3sJoinInfo: vi.fn(),
  listClusterNodeDetails: vi.fn(),
  getK3sHealth: vi.fn(),
  getCopilotTools: vi.fn(),
  saveK3sJoinScript: vi.fn(),
  provisionK3sNodeViaSsh: vi.fn(),
  provisionK3sBatchNodes: vi.fn(),
  tuneK3sNode: vi.fn(),
  kmodK3sNode: vi.fn(),
  pingK3sNodes: vi.fn(),
  killK3sCluster: vi.fn(),
  buildK3sCluster: vi.fn(),
  upK3sCluster: vi.fn(),
  deployK3sRegistries: vi.fn(),
  manageEtcdSnapshot: vi.fn(),
  drainK3sNode: vi.fn(),
  uncordonK3sNode: vi.fn(),
  cordonK3sNode: vi.fn(),
  rotateK3sCertificates: vi.fn(),
  upgradeK3sCluster: vi.fn(),
  setupK3sVip: vi.fn(),
  teardownK3sVip: vi.fn(),
  syncK3sBackups: vi.fn(),
  bundleK3sAirgap: vi.fn(),
  installK3sCni: vi.fn(),
  rotateK3sSecrets: vi.fn(),
  scanK3sSecurity: vi.fn(),
  installK3sStorage: vi.fn(),
  snapshotK3sVolume: vi.fn(),
  installK3sMonitoring: vi.fn(),
  dispatchAlert: vi.fn(),
  setupK3sGpu: vi.fn(),
  setupK3sModelCache: vi.fn(),
  preloadK3sModel: vi.fn(),
  runK3sHealer: vi.fn(),
  runK3sDrDrill: vi.fn(),
  installK3sGatewayCrds: vi.fn(),
  deployK3sGateway: vi.fn(),
  createK3sCanaryRoute: vi.fn(),
  provisionK3sPooledNode: vi.fn(),
  drainIdleK3sNodes: vi.fn(),
  applyK3sRightSizing: vi.fn(),
  executeCopilotTool: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    getK3sJoinInfo: hoisted.getK3sJoinInfo,
    listClusterNodeDetails: hoisted.listClusterNodeDetails,
    getK3sHealth: hoisted.getK3sHealth,
    getCopilotTools: hoisted.getCopilotTools,
    saveK3sJoinScript: hoisted.saveK3sJoinScript,
    provisionK3sNodeViaSsh: hoisted.provisionK3sNodeViaSsh,
    provisionK3sBatchNodes: hoisted.provisionK3sBatchNodes,
    tuneK3sNode: hoisted.tuneK3sNode,
    kmodK3sNode: hoisted.kmodK3sNode,
    pingK3sNodes: hoisted.pingK3sNodes,
    killK3sCluster: hoisted.killK3sCluster,
    buildK3sCluster: hoisted.buildK3sCluster,
    upK3sCluster: hoisted.upK3sCluster,
    deployK3sRegistries: hoisted.deployK3sRegistries,
    manageEtcdSnapshot: hoisted.manageEtcdSnapshot,
    drainK3sNode: hoisted.drainK3sNode,
    uncordonK3sNode: hoisted.uncordonK3sNode,
    cordonK3sNode: hoisted.cordonK3sNode,
    rotateK3sCertificates: hoisted.rotateK3sCertificates,
    upgradeK3sCluster: hoisted.upgradeK3sCluster,
    setupK3sVip: hoisted.setupK3sVip,
    teardownK3sVip: hoisted.teardownK3sVip,
    syncK3sBackups: hoisted.syncK3sBackups,
    bundleK3sAirgap: hoisted.bundleK3sAirgap,
    installK3sCni: hoisted.installK3sCni,
    rotateK3sSecrets: hoisted.rotateK3sSecrets,
    scanK3sSecurity: hoisted.scanK3sSecurity,
    installK3sStorage: hoisted.installK3sStorage,
    snapshotK3sVolume: hoisted.snapshotK3sVolume,
    installK3sMonitoring: hoisted.installK3sMonitoring,
    dispatchAlert: hoisted.dispatchAlert,
    setupK3sGpu: hoisted.setupK3sGpu,
    setupK3sModelCache: hoisted.setupK3sModelCache,
    preloadK3sModel: hoisted.preloadK3sModel,
    runK3sHealer: hoisted.runK3sHealer,
    runK3sDrDrill: hoisted.runK3sDrDrill,
    installK3sGatewayCrds: hoisted.installK3sGatewayCrds,
    deployK3sGateway: hoisted.deployK3sGateway,
    createK3sCanaryRoute: hoisted.createK3sCanaryRoute,
    provisionK3sPooledNode: hoisted.provisionK3sPooledNode,
    drainIdleK3sNodes: hoisted.drainIdleK3sNodes,
    applyK3sRightSizing: hoisted.applyK3sRightSizing,
    executeCopilotTool: hoisted.executeCopilotTool,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET, POST } from './route';

/**
 * Behavior tests for /api/cluster/k3s (Plan III §5.1 tranche 2). The
 * route is a thin dispatcher over the orchestrator's k3s operations;
 * the execution seams are stubbed at the module boundary so no cluster
 * work is ever spawned, while the authz guard runs for real against a
 * stubbed store (the k8s/exec route test pattern).
 */

const ownerToken = generatePrincipalToken();
const operatorToken = generatePrincipalToken();
const viewerToken = generatePrincipalToken();
const joinerToken = generatePrincipalToken();

const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};
const operator: Principal = {
  id: 'p_op', name: 'Oscar Operator', kind: 'human', role: 'operator',
  tokenHash: hashToken(operatorToken),
};
const viewer: Principal = {
  id: 'p_view', name: 'Vic Viewer', kind: 'human', role: 'viewer',
  tokenHash: hashToken(viewerToken),
};
// A service principal holding ONLY cluster:nodes:join (via an explicit
// unscoped grant) — the exact principal the B5 split must contain.
const joiner: Principal = {
  id: 'p_join', name: 'Judy Joiner', kind: 'service', role: 'viewer',
  tokenHash: hashToken(joinerToken),
  grants: [{ permission: 'cluster:nodes:join' }],
};

const JOIN_INFO = {
  serverUrl: 'https://192.168.1.10:6443',
  token: 'K10fake::server:secret',
  tokenMasked: 'K10f...cret',
  agentOneLiner: 'curl -sfL https://get.k3s.io | sh -',
};

function readyStore() {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [owner, operator, viewer, joiner] } };
}

function getReq(url: string, token?: string) {
  return new Request(url, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/cluster/k3s', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const BASE = 'http://localhost:3000/api/cluster/k3s';

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-k3s-route-'));
  for (const fn of Object.values(hoisted)) {
    if (typeof fn === 'object' && fn !== null && 'mockReset' in (fn as object)) {
      (fn as unknown as { mockReset: () => void }).mockReset();
    }
  }
  hoisted.getK3sJoinInfo.mockReturnValue(JOIN_INFO);
  hoisted.listClusterNodeDetails.mockResolvedValue([{ name: 'node-1', role: 'server' }]);
  hoisted.getK3sHealth.mockResolvedValue({ score: 98, status: 'HEALTHY' });
  hoisted.getCopilotTools.mockReturnValue([{ id: 'tool-1', name: 'nodes' }]);
  hoisted.provisionK3sNodeViaSsh.mockReturnValue({ id: 'task-ssh-1' });
  hoisted.drainK3sNode.mockReturnValue({ id: 'task-drain-1' });
  hoisted.cordonK3sNode.mockReturnValue({ id: 'task-cordon-1' });
  hoisted.uncordonK3sNode.mockReturnValue({ id: 'task-uncordon-1' });
  for (const fn of [
    hoisted.provisionK3sBatchNodes, hoisted.tuneK3sNode, hoisted.kmodK3sNode,
    hoisted.pingK3sNodes, hoisted.killK3sCluster, hoisted.buildK3sCluster,
    hoisted.upK3sCluster, hoisted.deployK3sRegistries, hoisted.manageEtcdSnapshot,
    hoisted.rotateK3sCertificates, hoisted.upgradeK3sCluster, hoisted.setupK3sVip,
    hoisted.teardownK3sVip, hoisted.syncK3sBackups, hoisted.bundleK3sAirgap,
    hoisted.installK3sCni, hoisted.rotateK3sSecrets, hoisted.scanK3sSecurity,
    hoisted.installK3sStorage, hoisted.snapshotK3sVolume, hoisted.installK3sMonitoring,
    hoisted.dispatchAlert, hoisted.setupK3sGpu, hoisted.setupK3sModelCache,
    hoisted.preloadK3sModel, hoisted.runK3sHealer, hoisted.runK3sDrDrill,
    hoisted.installK3sGatewayCrds, hoisted.deployK3sGateway, hoisted.createK3sCanaryRoute,
    hoisted.provisionK3sPooledNode, hoisted.drainIdleK3sNodes, hoisted.applyK3sRightSizing,
  ]) fn.mockReturnValue({ id: 'task-1' });
  hoisted.executeCopilotTool.mockResolvedValue({ ok: true });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('GET /api/cluster/k3s — join info default', () => {
  it('returns join info plus node details while authz is disabled', async () => {
    const res = await GET(getReq(BASE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.serverUrl).toBe(JOIN_INFO.serverUrl);
    expect(body.nodes).toEqual([{ name: 'node-1', role: 'server' }]);
    expect(hoisted.getK3sJoinInfo).toHaveBeenCalledWith(hoisted.root, {
      role: 'agent', serverUrl: undefined, token: undefined,
    });
  });

  it('forwards role/serverUrl/token query params to the join-info call', async () => {
    const res = await GET(getReq(`${BASE}?role=server&serverUrl=https://k3s.lan:6443&token=tok123`));
    expect(res.status).toBe(200);
    expect(hoisted.getK3sJoinInfo).toHaveBeenCalledWith(hoisted.root, {
      role: 'server', serverUrl: 'https://k3s.lan:6443', token: 'tok123',
    });
  });

  it('requires cluster:nodes:join for the default response once a store exists', async () => {
    readyStore();
    const anon = await GET(getReq(BASE));
    expect(anon.status).toBe(401);
    expect((await anon.json()).error.reason).toBe('deny_unauthenticated');

    // viewer and operator both hold cluster:read but NOT nodes:join.
    const asViewer = await GET(getReq(BASE, viewerToken));
    expect(asViewer.status).toBe(403);
    const asOperator = await GET(getReq(BASE, operatorToken));
    expect(asOperator.status).toBe(403);
    expect(hoisted.getK3sJoinInfo).not.toHaveBeenCalled();

    const asOwner = await GET(getReq(BASE, ownerToken));
    expect(asOwner.status).toBe(200);
  });
});

describe('GET /api/cluster/k3s — read actions', () => {
  it('serves enumerated read actions under cluster:read', async () => {
    readyStore();
    const res = await GET(getReq(`${BASE}?action=health`, viewerToken));
    expect(res.status).toBe(200);
    expect((await res.json()).score).toBe(98);
    expect(hoisted.getK3sHealth).toHaveBeenCalledWith(hoisted.root);
    expect(hoisted.getK3sJoinInfo).not.toHaveBeenCalled();
  });

  it('rejects unknown actions with 400 before any authz check (sweep regression)', async () => {
    readyStore();
    const res = await GET(getReq(`${BASE}?action=bogus`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('bad_request');
    expect(body.error.message).toBe('Unknown action: bogus');
    expect(hoisted.getK3sJoinInfo).not.toHaveBeenCalled();
  });

  it('returns copilot tools without a cluster call', async () => {
    const res = await GET(getReq(`${BASE}?action=copilot-tools`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'tool-1', name: 'nodes' }]);
  });

  it('maps a failing read action to the 500 envelope with the generic fallback', async () => {
    hoisted.getK3sHealth.mockRejectedValue(new Error('kubectl exploded at /internal/path'));
    const res = await GET(getReq(`${BASE}?action=health`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('internal');
    expect(body.error.message).toBe('Failed to retrieve K3s cluster join details');
  });
});

describe('POST /api/cluster/k3s — dispatch', () => {
  it('denies anonymous and operator callers for join-info (no nodes:join)', async () => {
    readyStore();
    const anon = await POST(postReq({ action: 'join-info' }));
    expect(anon.status).toBe(401);
    const asOperator = await POST(postReq({ action: 'join-info' }, operatorToken));
    expect(asOperator.status).toBe(403);
    expect(hoisted.getK3sJoinInfo).not.toHaveBeenCalled();
  });

  // BUG FIX (bug hunt B5): the old test asserted every POST action
  // was gated behind cluster:nodes:join. Actions now split by effect:
  // join-family + routine node lifecycle stay on nodes:join, while
  // cluster-wide/destructive actions require cluster:manage.
  it.each([
    [{ action: 'join-info' }, 'getK3sJoinInfo'],
    [{ action: 'generate-script' }, 'saveK3sJoinScript'],
    [{ action: 'ssh-join', targetHost: 'root@10.0.0.5' }, 'provisionK3sNodeViaSsh'],
    [{ action: 'batch-join' }, 'provisionK3sBatchNodes'],
    [{ action: 'tune' }, 'tuneK3sNode'],
    [{ action: 'kmod' }, 'kmodK3sNode'],
    [{ action: 'ping' }, 'pingK3sNodes'],
    [{ action: 'drain', nodeName: 'node-1' }, 'drainK3sNode'],
    [{ action: 'uncordon', nodeName: 'node-1' }, 'uncordonK3sNode'],
    [{ action: 'cordon', nodeName: 'node-1' }, 'cordonK3sNode'],
    [{ action: 'snapshot', operation: 'save' }, 'manageEtcdSnapshot'],
    [{ action: 'security-scan' }, 'scanK3sSecurity'],
    [{ action: 'alert-dispatch' }, 'dispatchAlert'],
    [{ action: 'pool-provision' }, 'provisionK3sPooledNode'],
    [{ action: 'pool-drain' }, 'drainIdleK3sNodes'],
  ])('nodes:join principal may run join/lifecycle action %j', async (body, fnName) => {
    readyStore();
    const res = await POST(postReq(body, joinerToken));
    expect(res.status).toBe(200);
    expect((hoisted as unknown as Record<string, { mock: { calls: unknown[][] } }>)[fnName].mock.calls.length).toBeGreaterThan(0);
  });

  it.each([
    [{ action: 'kill' }, 'killK3sCluster'],
    [{ action: 'build' }, 'buildK3sCluster'],
    [{ action: 'rebuild' }, 'buildK3sCluster'],
    [{ action: 'up' }, 'upK3sCluster'],
    [{ action: 'registries' }, 'deployK3sRegistries'],
    [{ action: 'rotate-certs' }, 'rotateK3sCertificates'],
    [{ action: 'upgrade' }, 'upgradeK3sCluster'],
    [{ action: 'vip-setup' }, 'setupK3sVip'],
    [{ action: 'vip-teardown' }, 'teardownK3sVip'],
    [{ action: 'backup-sync' }, 'syncK3sBackups'],
    [{ action: 'airgap-bundle' }, 'bundleK3sAirgap'],
    [{ action: 'cni-install' }, 'installK3sCni'],
    [{ action: 'secrets-rotate' }, 'rotateK3sSecrets'],
    [{ action: 'storage-install' }, 'installK3sStorage'],
    [{ action: 'storage-snapshot', pvcName: 'pvc-1' }, 'snapshotK3sVolume'],
    [{ action: 'monitoring-install' }, 'installK3sMonitoring'],
    [{ action: 'gpu-setup' }, 'setupK3sGpu'],
    [{ action: 'model-cache-setup' }, 'setupK3sModelCache'],
    [{ action: 'model-cache-preload', modelName: 'm' }, 'preloadK3sModel'],
    [{ action: 'healer-run' }, 'runK3sHealer'],
    [{ action: 'repair-gotrue' }, 'runK3sHealer'],
    [{ action: 'dr-drill-run' }, 'runK3sDrDrill'],
    [{ action: 'gateway-install-crds' }, 'installK3sGatewayCrds'],
    [{ action: 'gateway-deploy' }, 'deployK3sGateway'],
    [{ action: 'gateway-canary' }, 'createK3sCanaryRoute'],
    [{ action: 'finops-apply', workload: 'w' }, 'applyK3sRightSizing'],
    [{ action: 'copilot-tool-exec', toolId: 't' }, 'executeCopilotTool'],
    [{ action: 'snapshot', operation: 'restore' }, 'manageEtcdSnapshot'],
    [{ action: 'snapshot', operation: 'prune' }, 'manageEtcdSnapshot'],
  ])('nodes:join principal is denied cluster:manage action %j', async (body, fnName) => {
    readyStore();
    const res = await POST(postReq(body, joinerToken));
    expect(res.status).toBe(403);
    expect((hoisted as unknown as Record<string, { mock: { calls: unknown[][] } }>)[fnName].mock.calls.length).toBe(0);
  });

  it('owner may still run a cluster:manage action (kill)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'kill' }, ownerToken));
    expect(res.status).toBe(200);
    expect(hoisted.killK3sCluster).toHaveBeenCalled();
  });

  it('defaults to join-info and echoes the orchestrator result', async () => {
    const res = await POST(postReq({ role: 'server', nodeName: 'n2' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.serverUrl).toBe(JOIN_INFO.serverUrl);
    expect(hoisted.getK3sJoinInfo).toHaveBeenCalledWith(hoisted.root, expect.objectContaining({
      role: 'server', nodeName: 'n2',
    }));
  });

  it('validates ssh-join input before dispatching', async () => {
    const res = await POST(postReq({ action: 'ssh-join' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(
      'Target host (user@ip) is required for SSH provisioning'
    );
    expect(hoisted.provisionK3sNodeViaSsh).not.toHaveBeenCalled();
  });

  it('dispatches ssh-join with coerced port/boolean options and returns the task id', async () => {
    const res = await POST(postReq({
      action: 'ssh-join', targetHost: 'root@10.0.0.5', port: '2222', tune: true,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.taskId).toBe('task-ssh-1');
    expect(body.message).toBe('SSH node provisioning started (Task: task-ssh-1)');
    expect(hoisted.provisionK3sNodeViaSsh).toHaveBeenCalledWith(hoisted.root, expect.objectContaining({
      targetHost: 'root@10.0.0.5', role: 'agent', port: 2222,
      tune: true, copyRegistries: false, copyKubeconfig: false,
    }));
  });

  it('validates drain/cordon node names and dispatches with the name', async () => {
    const noName = await POST(postReq({ action: 'drain' }));
    expect(noName.status).toBe(400);
    expect((await noName.json()).error.message).toBe('Node name is required for drain operation');
    expect(hoisted.drainK3sNode).not.toHaveBeenCalled();

    const res = await POST(postReq({ action: 'drain', nodeName: 'node-1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).taskId).toBe('task-drain-1');
    expect(hoisted.drainK3sNode).toHaveBeenCalledWith(hoisted.root, 'node-1', undefined);

    const cordon = await POST(postReq({ action: 'cordon', nodeName: 'node-2' }));
    expect(cordon.status).toBe(200);
    expect(hoisted.cordonK3sNode).toHaveBeenCalledWith(hoisted.root, 'node-2');
  });

  it('rejects unknown POST actions with 400', async () => {
    const res = await POST(postReq({ action: 'frobnicate' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Unknown action: frobnicate');
  });

  it('maps an executor failure to the 500 envelope without leaking internals', async () => {
    hoisted.provisionK3sNodeViaSsh.mockImplementation(() => {
      throw new Error('ssh to root@10.0.0.5 failed: /internal/banner');
    });
    const res = await POST(postReq({ action: 'ssh-join', targetHost: 'root@10.0.0.5' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('internal');
    expect(body.error.message).toBe('K3s operation failed');
  });
});
