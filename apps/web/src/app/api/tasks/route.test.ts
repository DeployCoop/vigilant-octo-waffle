import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  tasks: [] as Array<{
    id: string;
    command: string;
    args: string[];
    status: string;
    exitCode: number | null;
    startedAt: string;
    finishedAt: string;
    logs: unknown[];
    principalId: string | null;
  }>,
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    processManager: { getAllTasks: () => hoisted.tasks },
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET } from './route';

/**
 * Behavior tests for GET /api/tasks scoping (bug-hunt Batch A5): a caller
 * sees their own tasks plus system tasks, never another principal's;
 * owner/admin see everything; with authz disabled there is no scoping.
 * Args go through the same redaction as the task log line.
 */

const viewerToken = generatePrincipalToken();
const otherToken = generatePrincipalToken();
const ownerToken = generatePrincipalToken();
const viewer: Principal = {
  id: 'p_view', name: 'Vic Viewer', kind: 'human', role: 'viewer',
  tokenHash: hashToken(viewerToken),
};
const other: Principal = {
  id: 'p_other', name: 'Ollie Operator', kind: 'human', role: 'operator',
  tokenHash: hashToken(otherToken),
};
const owner: Principal = {
  id: 'p_owner', name: 'Owen Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};

function getReq(token?: string) {
  return new Request('http://localhost:3000/api/tasks', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  // Tmp project root: denied requests audit-log to <root>/.vow/audit.log.
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-tasks-get-'));
  hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer, other, owner] } };
  hoisted.tasks = [
    {
      id: 't-viewer', command: 'echo', args: ['hi'], status: 'completed',
      exitCode: 0, startedAt: '2026-11-04T00:00:00.000Z', finishedAt: '2026-11-04T00:00:01.000Z',
      logs: [], principalId: 'p_view',
    },
    {
      id: 't-other', command: 'echo', args: ['hi'], status: 'completed',
      exitCode: 0, startedAt: '2026-11-04T00:00:00.000Z', finishedAt: '2026-11-04T00:00:01.000Z',
      logs: [], principalId: 'p_other',
    },
    {
      id: 't-system', command: 'echo', args: ['hi'], status: 'completed',
      exitCode: 0, startedAt: '2026-11-04T00:00:00.000Z', finishedAt: '2026-11-04T00:00:01.000Z',
      logs: [], principalId: null,
    },
    {
      id: 't-token', command: 'bash', args: ['script.sh', '--token', 'SECRET-XYZ'], status: 'completed',
      exitCode: 0, startedAt: '2026-11-04T00:00:00.000Z', finishedAt: '2026-11-04T00:00:01.000Z',
      logs: [], principalId: 'p_view',
    },
  ];
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('GET /api/tasks — scoping (bug-hunt Batch A5)', () => {
  it('requires tasks:read once a store exists', async () => {
    const anon = await GET(getReq());
    expect(anon.status).toBe(401);
  });

  it('a viewer sees only own + system tasks, never another principal\'s', async () => {
    const res = await GET(getReq(viewerToken));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<{ id: string }> };
    expect(body.tasks.map((t) => t.id).sort()).toEqual(['t-system', 't-token', 't-viewer']);
  });

  it('an owner sees everything', async () => {
    const res = await GET(getReq(ownerToken));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<{ id: string }> };
    expect(body.tasks.map((t) => t.id).sort()).toEqual(['t-other', 't-system', 't-token', 't-viewer']);
  });

  it('redacts --token values from surfaced args', async () => {
    const res = await GET(getReq(viewerToken));
    const body = (await res.json()) as { tasks: Array<{ id: string; args: string[] }> };
    const tokenTask = body.tasks.find((t) => t.id === 't-token');
    expect(tokenTask).toBeDefined();
    expect(tokenTask!.args).toEqual(['script.sh', '--token', '[redacted]']);
    expect(JSON.stringify(body)).not.toContain('SECRET-XYZ');
  });

  it('with authz disabled there is no scoping', async () => {
    hoisted.load = { status: 'disabled' };
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<{ id: string }> };
    expect(body.tasks.map((t) => t.id).sort()).toEqual(['t-other', 't-system', 't-token', 't-viewer']);
  });
});
