import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  generatePostmortem: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    generatePostmortem: hoisted.generatePostmortem,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { POST } from './route';

/** Validation tests for POST /api/postmortem (Batch C, C7). */

function postReq(body: unknown) {
  return new Request('http://localhost:3000/api/postmortem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-postmortem-'));
  hoisted.generatePostmortem.mockReset();
  hoisted.generatePostmortem.mockReturnValue({ id: 'pm-1' });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/postmortem validation (C7)', () => {
  it('rejects an unknown severity with 400', async () => {
    const res = await POST(postReq({ severity: 'SEV-9' }));
    expect(res.status).toBe(400);
    expect(hoisted.generatePostmortem).not.toHaveBeenCalled();
  });

  it('rejects a non-array affectedWorkloads with 400 (it used to 500 on .join())', async () => {
    const res = await POST(postReq({ affectedWorkloads: 'keycloak' }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty affectedWorkloads array with 400', async () => {
    const res = await POST(postReq({ affectedWorkloads: [] }));
    expect(res.status).toBe(400);
  });

  it('applies defaults when the body is empty', async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(200);
    expect(hoisted.generatePostmortem).toHaveBeenCalledWith({
      incidentTitle: 'Cascading Timeout on Authentication Subsystem',
      affectedWorkloads: ['keycloak-0', 'postgres-postgresql-0'],
      severity: 'SEV-2',
    });
  });
});
