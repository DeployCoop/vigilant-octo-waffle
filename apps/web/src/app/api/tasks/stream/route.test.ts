import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  byId: new Map<string, {
    id: string;
    command: string;
    args: string[];
    status: string;
    exitCode: number | null;
    startedAt: string;
    finishedAt: string;
    logs: Array<{ timestamp: string; type: string; message: string }>;
    emitter: { on: () => void; removeListener: () => void };
    principalId: string | null;
  }>(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    processManager: { getTask: (id: string) => hoisted.byId.get(id) },
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET } from './route';

/**
 * Behavior tests for GET /api/tasks/stream scoping (bug-hunt Batch A5):
 * an invisible task is reported exactly like a missing one (404), so
 * the response does not leak the task's existence.
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

function task(id: string, principalId: string | null) {
  return {
    id, command: 'echo', args: ['hi'], status: 'completed',
    exitCode: 0, startedAt: '2026-11-04T00:00:00.000Z', finishedAt: '2026-11-04T00:00:01.000Z',
    logs: [{ timestamp: '2026-11-04T00:00:00.000Z', type: 'system', message: 'Executing: echo hi' }],
    emitter: { on: () => undefined, removeListener: () => undefined },
    principalId,
  };
}

function getReq(taskId: string, token?: string) {
  return new Request(`http://localhost:3000/api/tasks/stream?taskId=${taskId}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  // Tmp project root: denied requests audit-log to <root>/.vow/audit.log.
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-tasks-stream-'));
  hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer, other, owner] } };
  hoisted.byId = new Map([
    ['t-own', task('t-own', 'p_view')],
    ['t-other', task('t-other', 'p_other')],
    ['t-system', task('t-system', null)],
  ]);
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('GET /api/tasks/stream — scoping (bug-hunt Batch A5)', () => {
  it('requires tasks:read once a store exists', async () => {
    const anon = await GET(getReq('t-own'));
    expect(anon.status).toBe(401);
  });

  it('a viewer can stream their own task and a system task', async () => {
    const own = await GET(getReq('t-own', viewerToken));
    expect(own.status).toBe(200);
    expect(await own.text()).toContain('Executing: echo hi');
    const system = await GET(getReq('t-system', viewerToken));
    expect(system.status).toBe(200);
  });

  it('a viewer gets 404 for another principal\'s task, identical to a missing task', async () => {
    const res = await GET(getReq('t-other', viewerToken));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Task not found');
    const missing = await GET(getReq('t-nope', viewerToken));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('Task not found');
  });

  it('an owner can stream another principal\'s task', async () => {
    const res = await GET(getReq('t-other', ownerToken));
    expect(res.status).toBe(200);
  });
});
