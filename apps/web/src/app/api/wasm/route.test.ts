import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  deployWasmMicroservice: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    deployWasmMicroservice: hoisted.deployWasmMicroservice,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { POST } from './route';

/** Validation tests for POST /api/wasm (Batch C, C7). */

function postReq(body: unknown) {
  return new Request('http://localhost:3000/api/wasm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-wasm-'));
  hoisted.deployWasmMicroservice.mockReset();
  hoisted.deployWasmMicroservice.mockReturnValue({
    success: true,
    manifest: 'kind: Deployment',
    message: 'ok',
  });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/wasm validation (C7)', () => {
  it('rejects a non-label namespace with 400', async () => {
    const res = await POST(
      postReq({ serviceId: 'wasm-rust-kv', namespace: 'Bad_Ns' })
    );
    expect(res.status).toBe(400);
    expect(hoisted.deployWasmMicroservice).not.toHaveBeenCalled();
  });

  it('rejects a non-label serviceId with 400', async () => {
    const res = await POST(postReq({ serviceId: 'WASM-RUST-KV' }));
    expect(res.status).toBe(400);
  });

  it('keeps an unknown serviceId as 200-with-success:false (C8 scope excludes wasm)', async () => {
    hoisted.deployWasmMicroservice.mockReturnValue({
      success: false,
      manifest: '',
      message: 'Wasm microservice no-such-service not found in catalog.',
    });
    const res = await POST(postReq({ serviceId: 'no-such-service' }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(false);
  });

  it('deploys a known service with the default namespace', async () => {
    const res = await POST(postReq({ serviceId: 'wasm-rust-kv' }));
    expect(res.status).toBe(200);
    expect(hoisted.deployWasmMicroservice).toHaveBeenCalledWith('wasm-rust-kv', 'default');
  });
});
