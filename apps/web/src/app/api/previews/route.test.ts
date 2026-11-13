import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  createPreviewEnvironment: vi.fn(),
  destroyPreviewEnvironment: vi.fn(),
  extendPreviewTtl: vi.fn(),
  cleanupExpiredPreviews: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    createPreviewEnvironment: hoisted.createPreviewEnvironment,
    destroyPreviewEnvironment: hoisted.destroyPreviewEnvironment,
    extendPreviewTtl: hoisted.extendPreviewTtl,
    cleanupExpiredPreviews: hoisted.cleanupExpiredPreviews,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { POST, DELETE, PATCH } from './route';

/** Validation + not-found tests for /api/previews (Batch C, C7/C8). */

function postReq(body: unknown) {
  return new Request('http://localhost:3000/api/previews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown) {
  return new Request('http://localhost:3000/api/previews', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-previews-'));
  hoisted.createPreviewEnvironment.mockReset();
  hoisted.destroyPreviewEnvironment.mockReset();
  hoisted.extendPreviewTtl.mockReset();
  hoisted.cleanupExpiredPreviews.mockReset();
  hoisted.createPreviewEnvironment.mockReturnValue({ id: 'prev-pr-12-app' });
  hoisted.destroyPreviewEnvironment.mockReturnValue({ success: true, message: 'ok' });
  hoisted.extendPreviewTtl.mockReturnValue({ id: 'prev-pr-12-app' });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/previews validation (C7)', () => {
  const base = { prNumber: 12, branch: 'main', appName: 'app' };

  it('rejects a string prNumber with 400 (no Number() coercion)', async () => {
    const res = await POST(postReq({ ...base, prNumber: '12' }));
    expect(res.status).toBe(400);
    expect(hoisted.createPreviewEnvironment).not.toHaveBeenCalled();
  });

  it('rejects NaN prNumber with 400 (no more prev-pr-NaN-app ids)', async () => {
    const res = await POST(postReq({ ...base, prNumber: Number.NaN }));
    expect(res.status).toBe(400);
    expect(hoisted.createPreviewEnvironment).not.toHaveBeenCalled();
  });

  it('rejects non-positive and out-of-range ttlMinutes with 400', async () => {
    expect((await POST(postReq({ ...base, ttlMinutes: -5 }))).status).toBe(400);
    expect((await POST(postReq({ ...base, ttlMinutes: 0 }))).status).toBe(400);
    expect((await POST(postReq({ ...base, ttlMinutes: 10081 }))).status).toBe(400);
  });

  it('creates with ttlMinutes defaulting to 120', async () => {
    const res = await POST(postReq(base));
    expect(res.status).toBe(200);
    expect(hoisted.createPreviewEnvironment).toHaveBeenCalledWith({
      prNumber: 12,
      branch: 'main',
      appName: 'app',
      ttlMinutes: 120,
    });
  });
});

describe('DELETE /api/previews + PATCH /api/previews (C7/C8)', () => {
  it('returns 404 when destroying an unknown preview', async () => {
    hoisted.destroyPreviewEnvironment.mockReturnValue({
      success: false,
      message: 'Preview environment prev-nope not found',
    });
    const res = await DELETE(
      new Request('http://localhost:3000/api/previews?id=prev-nope', { method: 'DELETE' })
    );
    expect(res.status).toBe(404);
  });

  it('rejects a string additionalMinutes with 400 on PATCH', async () => {
    const res = await PATCH(patchReq({ id: 'prev-pr-12-app', additionalMinutes: '60' }));
    expect(res.status).toBe(400);
    expect(hoisted.extendPreviewTtl).not.toHaveBeenCalled();
  });

  it('returns 404 when extending an unknown preview', async () => {
    hoisted.extendPreviewTtl.mockReturnValue(null);
    const res = await PATCH(patchReq({ id: 'prev-nope', additionalMinutes: 60 }));
    expect(res.status).toBe(404);
  });
});
