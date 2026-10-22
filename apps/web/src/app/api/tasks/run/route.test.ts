import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  runCommand: vi.fn(),
  loadProjectConfig: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    processManager: { runCommand: hoisted.runCommand },
    loadProjectConfig: hoisted.loadProjectConfig,
    // validateCommand deliberately NOT overridden: the allowlist is
    // the contract under test.
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { POST } from './route';

/**
 * Behavior tests for POST /api/tasks/run (Plan III §5.1 tranche 2).
 * The process manager is stubbed at the module boundary so nothing is
 * ever spawned; validateCommand stays real against a tmp project root
 * holding one fixture script, because its allowlist decisions are the
 * route's validation contract.
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

function postReq(rawBody: string, token?: string) {
  return new Request('http://localhost:3000/api/tasks/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: rawBody,
  });
}
const postJson = (body: unknown, token?: string) => postReq(JSON.stringify(body), token);

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-tasks-run-'));
  // Fixture project script the real allowlist can resolve.
  fs.mkdirSync(path.join(hoisted.root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(hoisted.root, 'src', 'k3s_add_node.sh'), '#!/usr/bin/env bash\n');
  hoisted.runCommand.mockReset();
  hoisted.loadProjectConfig.mockReset();
  hoisted.loadProjectConfig.mockReturnValue({ raw: { THIS_FOO: 'bar' } });
  hoisted.runCommand.mockImplementation((command: string, args: string[]) => ({
    id: 'task-7', command, args,
  }));
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/tasks/run — gate', () => {
  it('requires tasks:run once a store exists', async () => {
    hoisted.load = { status: 'ready', store: { version: 1, principals: [operator, viewer] } };
    const body = { command: 'bash', args: ['src/k3s_add_node.sh'] };
    const anon = await POST(postJson(body));
    expect(anon.status).toBe(401);
    const asViewer = await POST(postJson(body, viewerToken));
    expect(asViewer.status).toBe(403);
    expect(hoisted.runCommand).not.toHaveBeenCalled();

    const asOperator = await POST(postJson(body, operatorToken));
    expect(asOperator.status).toBe(200);
  });
});

describe('POST /api/tasks/run — validation (real allowlist)', () => {
  it('rejects a missing or non-string command', async () => {
    const missing = await POST(postJson({ args: [] }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toBe('Valid command string required');

    const numeric = await POST(postJson({ command: 42 }));
    expect(numeric.status).toBe(400);
    expect(hoisted.runCommand).not.toHaveBeenCalled();
  });

  it('treats an unparseable body as empty and rejects it the same way', async () => {
    const res = await POST(postReq('{not json'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Valid command string required');
  });

  it('rejects binaries outside the allowlist', async () => {
    const res = await POST(postJson({ command: 'rm', args: ['-rf', '/'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(
      /^Command rejected by orchestrator allowlist: /
    );
    expect(hoisted.runCommand).not.toHaveBeenCalled();
  });

  it('rejects bash shell-evaluation flags', async () => {
    const res = await POST(postJson({ command: 'bash', args: ['-c', 'echo hi'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain('strictly forbidden');
    expect(hoisted.runCommand).not.toHaveBeenCalled();
  });

  it('rejects script paths that escape the project root', async () => {
    const res = await POST(postJson({ command: 'bash', args: ['../outside.sh'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain(
      'Script path must remain within the repository root'
    );
    expect(hoisted.runCommand).not.toHaveBeenCalled();
  });

  it('rejects scripts that do not exist on disk', async () => {
    const res = await POST(postJson({ command: 'bash', args: ['src/nope.sh'] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain('does not exist on disk');
    expect(hoisted.runCommand).not.toHaveBeenCalled();
  });
});

describe('POST /api/tasks/run — dispatch contract', () => {
  it('hands the original command and stringified args to the process manager', async () => {
    const res = await POST(postJson({
      command: 'bash', args: ['src/k3s_add_node.sh', '--get-url'],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.taskId).toBe('task-7');
    expect(body.command).toBe('bash src/k3s_add_node.sh --get-url');
    expect(hoisted.runCommand).toHaveBeenCalledWith(
      'bash',
      ['src/k3s_add_node.sh', '--get-url'],
      { cwd: hoisted.root, env: { THIS_FOO: 'bar' } }
    );
  });

  it('coerces non-string args with String() and defaults args to []', async () => {
    const coerced = await POST(postJson({
      command: 'bash', args: ['src/k3s_add_node.sh', 42, true],
    }));
    expect(coerced.status).toBe(200);
    expect(hoisted.runCommand).toHaveBeenCalledWith(
      'bash', ['src/k3s_add_node.sh', '42', 'true'], expect.anything()
    );

    hoisted.runCommand.mockClear();
    const bare = await POST(postJson({ command: 'bash', args: 'not-an-array' }));
    // A non-array args value is treated as no args; bash with no script
    // target is itself an allowlist rejection.
    expect(bare.status).toBe(400);
    expect(hoisted.runCommand).not.toHaveBeenCalled();
  });

  it('maps a process-manager failure to the 500 envelope', async () => {
    hoisted.runCommand.mockImplementation(() => {
      throw new Error('spawn failed in /internal/dir');
    });
    const res = await POST(postJson({ command: 'bash', args: ['src/k3s_add_node.sh'] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toBe('Internal error');
  });
});
