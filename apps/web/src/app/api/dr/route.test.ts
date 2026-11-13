import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  executeDisasterRecoveryDrill: vi.fn(),
  getDRScorecard: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    executeDisasterRecoveryDrill: hoisted.executeDisasterRecoveryDrill,
    getDRScorecard: hoisted.getDRScorecard,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { POST } from './route';

/** Validation tests for POST /api/dr (Batch C, C7). */

function postReq(body: unknown) {
  return new Request('http://localhost:3000/api/dr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-dr-'));
  hoisted.executeDisasterRecoveryDrill.mockReset();
  hoisted.getDRScorecard.mockReset();
  hoisted.executeDisasterRecoveryDrill.mockReturnValue({
    drillId: 'dr-drill-001',
    scenario: 'POSTGRES_VOLUME_CORRUPTION',
    status: 'SUCCESS',
  });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/dr validation (C7)', () => {
  it('rejects an unknown scenario with 400 and does not run a drill', async () => {
    const res = await POST(postReq({ scenario: 'METEOR_STRIKE' }));
    expect(res.status).toBe(400);
    expect(hoisted.executeDisasterRecoveryDrill).not.toHaveBeenCalled();
  });

  it('accepts a valid scenario', async () => {
    const res = await POST(postReq({ scenario: 'NAMESPACE_ACCIDENTAL_DELETION' }));
    expect(res.status).toBe(200);
    expect(hoisted.executeDisasterRecoveryDrill).toHaveBeenCalledWith(
      'NAMESPACE_ACCIDENTAL_DELETION'
    );
  });

  it('defaults to POSTGRES_VOLUME_CORRUPTION when scenario is omitted', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(200);
    expect(hoisted.executeDisasterRecoveryDrill).toHaveBeenCalledWith(
      'POSTGRES_VOLUME_CORRUPTION'
    );
  });
});
