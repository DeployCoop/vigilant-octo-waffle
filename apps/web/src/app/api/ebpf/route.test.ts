import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  simulatePacketDropInspection: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    simulatePacketDropInspection: hoisted.simulatePacketDropInspection,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { POST } from './route';

/** Validation tests for POST /api/ebpf (Batch C, C7). */

function postReq(body: unknown) {
  return new Request('http://localhost:3000/api/ebpf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-ebpf-'));
  hoisted.simulatePacketDropInspection.mockReset();
  hoisted.simulatePacketDropInspection.mockReturnValue({
    sourcePod: 'api-1',
    targetPod: 'postgres-0',
    port: 5432,
    canConnect: true,
    reason: 'ok',
    latencyMs: 1.1,
  });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/ebpf validation (C7)', () => {
  it('rejects port 0 with 400', async () => {
    const res = await POST(postReq({ sourcePod: 'a', targetPod: 'b', port: 0 }));
    expect(res.status).toBe(400);
    expect(hoisted.simulatePacketDropInspection).not.toHaveBeenCalled();
  });

  it('rejects port 65536 with 400', async () => {
    const res = await POST(postReq({ sourcePod: 'a', targetPod: 'b', port: 65536 }));
    expect(res.status).toBe(400);
  });

  it('rejects a string port with 400 (no Number() coercion)', async () => {
    const res = await POST(postReq({ sourcePod: 'a', targetPod: 'b', port: '80' }));
    expect(res.status).toBe(400);
  });

  it('rejects a missing targetPod with 400', async () => {
    const res = await POST(postReq({ sourcePod: 'a', port: 80 }));
    expect(res.status).toBe(400);
  });

  it('accepts a valid inspection and defaults the port to 80', async () => {
    const res = await POST(postReq({ sourcePod: 'a', targetPod: 'b' }));
    expect(res.status).toBe(200);
    expect(hoisted.simulatePacketDropInspection).toHaveBeenCalledWith('a', 'b', 80);
  });
});
