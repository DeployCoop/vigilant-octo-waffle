import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  executeSyntheticLoad: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    executeSyntheticLoad: hoisted.executeSyntheticLoad,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { POST } from './route';

/** Validation + not-found tests for POST /api/keda (Batch C, C4/C7). */

function postReq(body: unknown) {
  return new Request('http://localhost:3000/api/keda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-keda-'));
  hoisted.executeSyntheticLoad.mockReset();
  hoisted.executeSyntheticLoad.mockReturnValue({
    targetWorkload: 'nextcloud-worker',
    totalRequests: 100,
  });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/keda validation (C7) + unknown workload (C4)', () => {
  it('rejects a negative targetRps with 400 (the old totalRequests: -250 repro)', async () => {
    const res = await POST(
      postReq({ targetWorkload: 'nextcloud-worker', targetRps: -50 })
    );
    expect(res.status).toBe(400);
    expect(hoisted.executeSyntheticLoad).not.toHaveBeenCalled();
  });

  it('rejects out-of-range durationSeconds with 400', async () => {
    const res = await POST(
      postReq({ targetWorkload: 'nextcloud-worker', durationSeconds: 3 })
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unknown pattern with 400', async () => {
    const res = await POST(
      postReq({ targetWorkload: 'nextcloud-worker', pattern: 'BURST' })
    );
    expect(res.status).toBe(400);
  });

  it('rejects string numerics with 400 (no Number() coercion)', async () => {
    const res = await POST(
      postReq({ targetWorkload: 'nextcloud-worker', virtualUsers: '20' })
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown workload instead of running store[0]', async () => {
    hoisted.executeSyntheticLoad.mockReturnValue(null);
    const res = await POST(postReq({ targetWorkload: 'no-such-workload' }));
    expect(res.status).toBe(404);
  });

  it('applies defaults and passes strict numerics through', async () => {
    const res = await POST(postReq({ targetWorkload: 'nextcloud-worker' }));
    expect(res.status).toBe(200);
    expect(hoisted.executeSyntheticLoad).toHaveBeenCalledWith({
      targetWorkload: 'nextcloud-worker',
      virtualUsers: 20,
      durationSeconds: 15,
      targetRps: 250,
      pattern: 'SPIKE',
    });
  });
});
