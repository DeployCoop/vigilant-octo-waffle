import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  raw: {} as Record<string, string>,
  getStorage: vi.fn(),
  getK3sStorageStatus: vi.fn(),
  installK3sStorage: vi.fn(),
  testK3sStorageBenchmark: vi.fn(),
  snapshotK3sVolume: vi.fn(),
  loadProjectConfig: vi.fn(),
  saveEnvFile: vi.fn(),
  execFileAsync: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    // The route constructs the client per request; the stub class reads
    // its behavior from the hoisted fn so tests can reprogram it.
    K8sClient: class {
      getStorage = hoisted.getStorage;
    },
    getK3sStorageStatus: hoisted.getK3sStorageStatus,
    installK3sStorage: hoisted.installK3sStorage,
    testK3sStorageBenchmark: hoisted.testK3sStorageBenchmark,
    snapshotK3sVolume: hoisted.snapshotK3sVolume,
    loadProjectConfig: hoisted.loadProjectConfig,
    saveEnvFile: hoisted.saveEnvFile,
    execFileAsync: hoisted.execFileAsync,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET, POST } from './route';

/**
 * Behavior tests for /api/storage (Plan III §5.1 tranche 2). Every
 * execution seam (K8s client, storage tasks, kubectl via execFileAsync,
 * env-file persistence) is stubbed at the module boundary; the label /
 * object-name validators stay real because they ARE the validation
 * contract, and the authz guard runs against a stubbed store.
 */

const ownerToken = generatePrincipalToken();
const operatorToken = generatePrincipalToken();
const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};
const operator: Principal = {
  id: 'p_op', name: 'Oscar Operator', kind: 'human', role: 'operator',
  tokenHash: hashToken(operatorToken),
};

function req(method: string, token?: string, body?: unknown) {
  return new Request('http://localhost:3000/api/storage', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-storage-route-'));
  hoisted.raw = {};
  for (const fn of [
    hoisted.getStorage, hoisted.getK3sStorageStatus, hoisted.installK3sStorage,
    hoisted.testK3sStorageBenchmark, hoisted.snapshotK3sVolume, hoisted.loadProjectConfig,
    hoisted.saveEnvFile, hoisted.execFileAsync,
  ]) fn.mockReset();
  hoisted.loadProjectConfig.mockImplementation(() => ({ raw: hoisted.raw }));
  hoisted.getStorage.mockResolvedValue({ storageClasses: [{ name: 'sc-1' }], pools: 2 });
  hoisted.getK3sStorageStatus.mockResolvedValue({
    status: 'deployed',
    config: { vg: 'StatusVG', fsType: 'xfs' },
  });
  hoisted.installK3sStorage.mockReturnValue({ id: 'task-install-1' });
  hoisted.testK3sStorageBenchmark.mockReturnValue({ id: 'task-bench-1' });
  hoisted.snapshotK3sVolume.mockReturnValue({ id: 'task-snap-1' });
  hoisted.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('GET /api/storage', () => {
  it('gates on storage:manage once a store exists', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [owner, operator] } };
    const anon = await GET(req('GET'));
    expect(anon.status).toBe(401);
    // operator is a powerful role but holds no storage:manage.
    const asOperator = await GET(req('GET', operatorToken));
    expect(asOperator.status).toBe(403);
    expect(hoisted.getStorage).not.toHaveBeenCalled();
  });

  it('merges cluster storage with the OpenEBS view derived from project env', async () => {
    hoisted.raw = { THIS_OPENEBS_ENGINE_ZFS: 'true', THIS_LVM_VG: 'DataVG' };
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.storageClasses).toEqual([{ name: 'sc-1' }]);
    expect(body.openEBS.status).toBe('deployed');
    // Engine flags: lvm/hostpath default on, zfs on via env, the rest off.
    expect(body.openEBS.configuredEngines).toEqual({
      lvm: true, hostpath: true, zfs: true, rawfile: false, mayastor: false,
      nats: false, minio: false, loki: false, alloy: false, nfs: false,
    });
    // Project env wins over the status-reported config.
    expect(body.openEBS.config.vg).toBe('DataVG');
    expect(body.openEBS.config.fsType).toBe('xfs');
    expect(body.openEBS.config.storageClass).toBe('openebs-lvmpv');
  });

  it('degrades to openEBS: null when the k3s storage probe fails', async () => {
    hoisted.getK3sStorageStatus.mockRejectedValue(new Error('no cluster'));
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openEBS).toBeNull();
    expect(body.pools).toBe(2);
  });

  it('maps a storage client failure to the 500 envelope', async () => {
    hoisted.getStorage.mockRejectedValue(new Error('kubeconfig at /internal/path unreadable'));
    const res = await GET(req('GET'));
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toBe('Internal error');
  });
});

describe('POST /api/storage', () => {
  it('rejects unknown actions with 400', async () => {
    const res = await POST(req('POST', undefined, { action: 'frobnicate' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Unknown action 'frobnicate'");
  });

  it('dispatches benchmark with the default and explicit storage classes', async () => {
    const def = await POST(req('POST', undefined, { action: 'benchmark' }));
    expect(def.status).toBe(200);
    expect((await def.json()).taskId).toBe('task-bench-1');
    expect(hoisted.testK3sStorageBenchmark).toHaveBeenCalledWith(hoisted.root, 'openebs-lvmpv');

    const explicit = await POST(req('POST', undefined, {
      action: 'benchmark', storageClass: 'fast-nvme',
    }));
    expect(explicit.status).toBe(200);
    expect((await explicit.json()).message).toContain("'fast-nvme'");
    expect(hoisted.testK3sStorageBenchmark).toHaveBeenCalledWith(hoisted.root, 'fast-nvme');
  });

  it('dispatches snapshot with the pvc and snapshot names', async () => {
    const res = await POST(req('POST', undefined, {
      action: 'snapshot', pvcName: 'data-0', snapshotName: 'snap-1',
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).taskId).toBe('task-snap-1');
    expect(hoisted.snapshotK3sVolume).toHaveBeenCalledWith(hoisted.root, 'data-0', 'snap-1');
  });

  it('configure-openebs persists the env translation and starts the install task', async () => {
    hoisted.raw = { EXISTING: 'keep' };
    const res = await POST(req('POST', undefined, {
      action: 'configure-openebs',
      options: { vg: 'VG9', thinProvision: true, shared: false, enableZfs: true, enableLvm: false },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).taskId).toBe('task-install-1');
    expect(hoisted.saveEnvFile).toHaveBeenCalledWith(hoisted.root, {
      EXISTING: 'keep',
      THIS_LVM_VG: 'VG9',
      THIS_LVM_THIN_PROVISION: 'yes',
      THIS_LVM_SHARED: 'no',
      THIS_OPENEBS_ENGINE_LVM: 'false',
      THIS_OPENEBS_ENGINE_ZFS: 'true',
    });
    expect(hoisted.installK3sStorage).toHaveBeenCalledWith(hoisted.root, {
      engine: 'openebs', vg: 'VG9', thinProvision: true, shared: false,
      enableZfs: true, enableLvm: false,
    });
  });

  it('maps an install-task failure to the 500 envelope without leaking internals', async () => {
    hoisted.installK3sStorage.mockImplementation(() => {
      throw new Error('helm failed in /internal/chart/dir');
    });
    const res = await POST(req('POST', undefined, { action: 'configure-openebs', options: {} }));
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toBe('Internal error');
  });
});

describe('POST /api/storage — kubectl actions', () => {
  it('label-nodes validates key and value before touching kubectl', async () => {
    const badValue = await POST(req('POST', undefined, {
      action: 'label-nodes', key: 'openebs.io/lvm', value: 'not a label!',
    }));
    expect(badValue.status).toBe(400);
    expect((await badValue.json()).error.message).toBe('Invalid label key or value');

    const badKey = await POST(req('POST', undefined, {
      action: 'label-nodes', key: 'bad key', value: 'true',
    }));
    expect(badKey.status).toBe(400);
    expect(hoisted.execFileAsync).not.toHaveBeenCalled();
  });

  it('label-nodes applies the default label via argv-only kubectl', async () => {
    const res = await POST(req('POST', undefined, { action: 'label-nodes' }));
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe(
      'Cluster nodes successfully labeled with openebs.io/lvm=true'
    );
    expect(hoisted.execFileAsync).toHaveBeenCalledWith('kubectl', [
      'label', 'nodes', '--all', 'openebs.io/lvm=true', '--overwrite',
    ]);
  });

  it('set-default-sc validates the name before any kubectl call', async () => {
    const missing = await POST(req('POST', undefined, { action: 'set-default-sc' }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toBe('StorageClass name required');

    const invalid = await POST(req('POST', undefined, {
      action: 'set-default-sc', storageClass: 'Bad_Name!',
    }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.message).toBe('Invalid StorageClass name');
    expect(hoisted.execFileAsync).not.toHaveBeenCalled();
  });

  it('set-default-sc un-defaults the old class, annotates the target, and persists env', async () => {
    hoisted.raw = { THIS_LVM_STORAGECLASS: 'openebs-lvmpv' };
    hoisted.execFileAsync.mockImplementation(async (_file: string, args: string[]) => {
      if (args[0] === 'get') {
        return {
          stdout: JSON.stringify({
            items: [
              { metadata: { name: 'old-sc', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } } },
              { metadata: { name: 'fast-sc', annotations: {} } },
            ],
          }),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });

    const res = await POST(req('POST', undefined, {
      action: 'set-default-sc', storageClass: 'fast-sc',
    }));
    expect(res.status).toBe(200);
    const annotateArgs = hoisted.execFileAsync.mock.calls
      .filter((c) => (c[1] as string[])[0] === 'annotate')
      .map((c) => c[1] as string[]);
    expect(annotateArgs).toEqual([
      ['annotate', 'sc', 'old-sc', '--overwrite', 'storageclass.kubernetes.io/is-default-class=false'],
      ['annotate', 'sc', 'fast-sc', '--overwrite', 'storageclass.kubernetes.io/is-default-class=true'],
    ]);
    expect(hoisted.saveEnvFile).toHaveBeenCalledWith(hoisted.root, {
      THIS_LVM_STORAGECLASS: 'openebs-lvmpv',
      THIS_STORAGE_DEFAULT_CLASS: 'fast-sc',
      THIS_LVM_IS_DEFAULT_SC: 'false',
    });

    // Targeting the LVM class itself flips THIS_LVM_IS_DEFAULT_SC to true.
    hoisted.saveEnvFile.mockClear();
    const lvmRes = await POST(req('POST', undefined, {
      action: 'set-default-sc', storageClass: 'openebs-lvmpv',
    }));
    expect(lvmRes.status).toBe(200);
    expect(hoisted.saveEnvFile).toHaveBeenCalledWith(hoisted.root, expect.objectContaining({
      THIS_STORAGE_DEFAULT_CLASS: 'openebs-lvmpv',
      THIS_LVM_IS_DEFAULT_SC: 'true',
    }));
  });
});
