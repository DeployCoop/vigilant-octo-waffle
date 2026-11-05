import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  loadWafflePipeline: vi.fn(),
  validateWafflePipeline: vi.fn(),
  getSources: vi.fn(),
  getActiveRun: vi.fn(),
  getHistory: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    getWaffleSourceManager: () => ({ getSources: hoisted.getSources, getSourcePipeline: vi.fn() }),
    getWaffleRunner: () => ({ getActiveRun: hoisted.getActiveRun }),
    getWaffleRunHistory: () => ({ getHistory: hoisted.getHistory }),
    getBuiltinBlueprints: () => [],
    loadWafflePipeline: hoisted.loadWafflePipeline,
    validateWafflePipeline: hoisted.validateWafflePipeline,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { GET } from './route';

/** Confinement tests for GET /api/waffle?validatePath= (bug hunt B11). */

function getReq(query: string) {
  return new Request(`http://localhost:3000/api/waffle?${query}`);
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-waffle-get-'));
  hoisted.loadWafflePipeline.mockReset();
  hoisted.validateWafflePipeline.mockReset();
  hoisted.loadWafflePipeline.mockResolvedValue({
    pipeline: { metadata: { name: 'P' }, stages: [] }, baseDir: hoisted.root,
  });
  hoisted.validateWafflePipeline.mockReturnValue({
    valid: true, errors: [], warnings: [], stagesCount: 0, stepsCount: 0,
  });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('GET /api/waffle validatePath confinement (B11)', () => {
  it('validates an in-root path', async () => {
    const res = await GET(getReq('validatePath=charts/waffle.yaml'));
    expect(res.status).toBe(200);
    expect(hoisted.loadWafflePipeline).toHaveBeenCalledWith(
      path.join(hoisted.root, 'charts/waffle.yaml')
    );
    expect((await res.json()).valid).toBe(true);
  });

  it('rejects an absolute path outside the project root', async () => {
    const res = await GET(getReq('validatePath=/etc/waffle.yaml'));
    expect(res.status).toBe(400);
    expect(hoisted.loadWafflePipeline).not.toHaveBeenCalled();
    expect((await res.json()).error.message).toBe('Failed to validate pipeline path');
  });

  it('rejects a ../ escape', async () => {
    const res = await GET(getReq('validatePath=..%2F..%2Fetc%2Fwaffle.yaml'));
    expect(res.status).toBe(400);
    expect(hoisted.loadWafflePipeline).not.toHaveBeenCalled();
  });
});
