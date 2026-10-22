import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  activeRun: null as null | { id: string; status: string; sourceId?: string },
  executePipeline: vi.fn(),
  getActiveRun: vi.fn(),
  getSourcePipeline: vi.fn(),
  getBlueprintById: vi.fn(),
  loadWafflePipeline: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    getWaffleRunner: () => ({
      executePipeline: hoisted.executePipeline,
      getActiveRun: hoisted.getActiveRun,
    }),
    getWaffleSourceManager: () => ({ getSourcePipeline: hoisted.getSourcePipeline }),
    getBlueprintById: hoisted.getBlueprintById,
    loadWafflePipeline: hoisted.loadWafflePipeline,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { POST } from './route';

/**
 * Behavior tests for POST /api/waffle/run (Plan III §5.1 tranche 2).
 * The WaffleRunner and source manager are stubbed at the module
 * boundary; the stub runner flips its active run synchronously, the
 * way the real runner has initialized by the time the route re-reads
 * it after its short startup delay.
 */

const operatorToken = generatePrincipalToken();
const viewerToken = generatePrincipalToken();
const operator: Principal = {
  id: 'p_op', name: 'Oscar Operator', kind: 'human', role: 'operator',
  tokenHash: hashToken(operatorToken),
};
const viewer: Principal = {
  id: 'p_view', name: 'Vic Viewer', kind: 'human', role: 'viewer',
  tokenHash: hashToken(viewerToken),
};

const BLUEPRINT = { metadata: { name: 'Waffle One' }, steps: [] };

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/waffle/run', {
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
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-waffle-run-'));
  hoisted.activeRun = null;
  for (const fn of [
    hoisted.executePipeline, hoisted.getActiveRun, hoisted.getSourcePipeline,
    hoisted.getBlueprintById, hoisted.loadWafflePipeline,
  ]) fn.mockReset();
  hoisted.getActiveRun.mockImplementation(() => hoisted.activeRun);
  hoisted.executePipeline.mockImplementation((opts: { sourceId: string }) => {
    hoisted.activeRun = { id: 'run-1', status: 'running', sourceId: opts.sourceId };
    return Promise.resolve();
  });
  hoisted.getBlueprintById.mockImplementation((id: string) =>
    id === 'bp-1' ? BLUEPRINT : undefined
  );
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/waffle/run — gate and input validation', () => {
  it('requires tasks:run once a store exists', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [operator, viewer] } };
    const anon = await POST(postReq({ blueprintId: 'bp-1' }));
    expect(anon.status).toBe(401);
    const asViewer = await POST(postReq({ blueprintId: 'bp-1' }, viewerToken));
    expect(asViewer.status).toBe(403);
    expect(hoisted.executePipeline).not.toHaveBeenCalled();
  });

  it('rejects a body with no source selector', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(
      'Specify either "sourceId", "blueprintId", or "customPath"'
    );
    expect(hoisted.executePipeline).not.toHaveBeenCalled();
  });

  it('404s an unknown blueprint id', async () => {
    const res = await POST(postReq({ blueprintId: 'nope' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe('Blueprint "nope" not found');
    expect(hoisted.executePipeline).not.toHaveBeenCalled();
  });
});

describe('POST /api/waffle/run — launch contract', () => {
  it('launches a blueprint pipeline against the project root', async () => {
    const res = await POST(postReq({ blueprintId: 'bp-1' }, operatorToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Started pipeline "Waffle One"');
    expect(body.run).toEqual({ id: 'run-1', status: 'running', sourceId: 'bp-1' });
    expect(hoisted.executePipeline).toHaveBeenCalledWith({
      sourceId: 'bp-1', pipeline: BLUEPRINT, baseDir: hoisted.root,
      dryRun: false, buildOnly: false,
    });
  });

  it('threads dryRun/buildOnly into the launch and the response message', async () => {
    const dry = await POST(postReq({ blueprintId: 'bp-1', dryRun: true }));
    expect((await dry.json()).message).toBe('Started dry-run of pipeline "Waffle One"');
    expect(hoisted.executePipeline).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true, buildOnly: false,
    }));

    hoisted.activeRun = null;
    const build = await POST(postReq({ blueprintId: 'bp-1', buildOnly: true }));
    expect((await build.json()).message).toBe('Started image rebuild for pipeline "Waffle One"');
    expect(hoisted.executePipeline).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: false, buildOnly: true,
    }));
  });

  it('resolves a stored source to its local path and canonical id', async () => {
    const pipeline = { metadata: { name: 'From Source' }, steps: [] };
    hoisted.getSourcePipeline.mockResolvedValue({
      pipeline,
      source: { id: 'src-9', localPath: '/data/sources/src-9' },
    });
    const res = await POST(postReq({ sourceId: 'requested-id' }));
    expect(res.status).toBe(200);
    expect(hoisted.getSourcePipeline).toHaveBeenCalledWith('requested-id');
    expect(hoisted.executePipeline).toHaveBeenCalledWith({
      sourceId: 'src-9', pipeline, baseDir: '/data/sources/src-9',
      dryRun: false, buildOnly: false,
    });
    expect((await res.json()).message).toBe('Started pipeline "From Source"');
  });

  it('loads a custom pipeline from disk with its own base dir', async () => {
    const pipeline = { metadata: { name: 'Ad Hoc' }, steps: [] };
    hoisted.loadWafflePipeline.mockResolvedValue({ pipeline, baseDir: '/tmp/adhoc' });
    const res = await POST(postReq({ customPath: '/tmp/adhoc/waffle.yaml' }));
    expect(res.status).toBe(200);
    expect(hoisted.loadWafflePipeline).toHaveBeenCalledWith('/tmp/adhoc/waffle.yaml');
    expect(hoisted.executePipeline).toHaveBeenCalledWith({
      sourceId: 'custom', pipeline, baseDir: '/tmp/adhoc',
      dryRun: false, buildOnly: false,
    });
  });

  it('refuses to launch while another run is in progress', async () => {
    hoisted.activeRun = { id: 'run-0', status: 'running' };
    const res = await POST(postReq({ blueprintId: 'bp-1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain('currently in progress');
    expect(hoisted.executePipeline).not.toHaveBeenCalled();
  });

  it('maps a source-resolution failure to the 500 envelope with the route fallback', async () => {
    hoisted.getSourcePipeline.mockRejectedValue(new Error('git clone failed in /internal/path'));
    const res = await POST(postReq({ sourceId: 'src-x' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('internal');
    expect(body.error.message).toBe('Failed to start pipeline');
  });
});
