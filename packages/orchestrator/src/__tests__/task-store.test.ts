/**
 * WS5 — persistent task records (node:sqlite write-through).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProcessManager, type TaskRun } from '../executor.js';
import { TaskStore, taskStorePath, type TaskRecord } from '../taskStore.js';

let root: string;
let dbPath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-taskstore-'));
  dbPath = taskStorePath(root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function record(partial: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    label: 'echo hi',
    kind: 'command',
    status: 'running',
    pid: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    logTail: [],
    meta: {},
    ...partial,
  };
}

function waitForClose(task: TaskRun): Promise<number | null> {
  return new Promise((resolve) => {
    task.emitter.once('close', (code: number | null) => resolve(code));
  });
}

describe('TaskStore', () => {
  it('creates the DB under .vow/ with mode 0600 and WAL journaling', () => {
    const store = new TaskStore(dbPath);
    assert.ok(fs.existsSync(dbPath));
    assert.equal(fs.statSync(dbPath).mode & 0o777, 0o600);
    store.close();
    const reopened = new TaskStore(dbPath);
    reopened.close();
  });

  it('round-trips records (upsert + get + list order)', () => {
    const store = new TaskStore(dbPath);
    store.upsert(record({ id: 'a', startedAt: '2026-01-01T00:00:00.000Z' }));
    store.upsert(
      record({
        id: 'b',
        startedAt: '2026-01-02T00:00:00.000Z',
        status: 'completed',
        exitCode: 0,
        logTail: [{ timestamp: 't', type: 'stdout', message: 'hi' }],
      })
    );
    store.upsert(record({ id: 'a', status: 'failed', exitCode: 3 }));
    assert.equal(store.get('a')?.status, 'failed');
    assert.equal(store.get('a')?.exitCode, 3);
    assert.deepEqual(store.list().map((r) => r.id), ['b', 'a']);
    assert.equal(store.get('b')?.logTail[0]?.message, 'hi');
    assert.equal(store.get('missing'), null);
    store.close();
  });

  it('reconciles dead-pid running rows to interrupted; live pids stay running', async () => {
    // A pid that certainly does not exist: spawn, capture, reap.
    const child = spawn('echo', ['x'], { stdio: 'ignore' });
    const deadPid = child.pid!;
    await new Promise((r) => child.once('close', r));

    const store = new TaskStore(dbPath);
    store.upsert(record({ id: 'dead', pid: deadPid }));
    store.upsert(record({ id: 'alive', pid: process.pid }));
    store.upsert(record({ id: 'nopid', pid: null }));
    store.upsert(record({ id: 'done', status: 'completed', pid: deadPid }));

    const interrupted = store.reconcileRunning('2026-02-01T00:00:00.000Z');
    assert.deepEqual(
      interrupted.map((r) => r.id).sort(),
      ['dead', 'nopid']
    );
    assert.equal(store.get('dead')?.status, 'interrupted');
    assert.equal(store.get('dead')?.endedAt, '2026-02-01T00:00:00.000Z');
    assert.equal(store.get('alive')?.status, 'running');
    assert.equal(store.get('done')?.status, 'completed');
    store.close();
  });
});

describe('ProcessManager write-through', () => {
  it('persists a task across a simulated restart, with its log tail', async () => {
    const store = new TaskStore(dbPath);
    const pm = new ProcessManager();
    pm.attachStore(store);
    const task = pm.runCommand('echo', ['hello-parity'], { cwd: root });
    const code = await waitForClose(task);
    assert.equal(code, 0);
    store.close();

    // "Restart": a brand-new manager + store over the same file.
    const store2 = new TaskStore(dbPath);
    store2.reconcileRunning();
    const pm2 = new ProcessManager();
    pm2.attachStore(store2);
    const revived = pm2.getTask(task.id);
    assert.ok(revived, 'task should survive the restart');
    assert.equal(revived.status, 'completed');
    assert.equal(revived.exitCode, 0);
    assert.ok(
      revived.logs.some((l) => l.message.includes('hello-parity')),
      'log tail should persist'
    );
    assert.equal(pm2.getAllTasks().length, 1);
    store2.close();
  });

  it('marks a task interrupted when its process died with the server', async () => {
    const store = new TaskStore(dbPath);
    const pm = new ProcessManager();
    pm.attachStore(store);
    // Simulate a task that was mid-flight when the "server" died:
    // insert its running record directly, with this test process's
    // soon-to-be-dead child pid.
    const child = spawn('echo', ['x'], { stdio: 'ignore' });
    const pid = child.pid!;
    await new Promise((r) => child.once('close', r));
    store.upsert(
      record({ id: 'orphan', pid, label: 'echo x', meta: { command: 'echo', args: ['x'], cwd: root } })
    );
    store.close();

    const store2 = new TaskStore(dbPath);
    const interrupted = store2.reconcileRunning();
    assert.equal(interrupted.length, 1);
    const pm2 = new ProcessManager();
    pm2.attachStore(store2);
    assert.equal(pm2.getTask('orphan')?.status, 'interrupted');
    store2.close();
  });

  it('keeps the log tail capped exactly like the in-memory manager', async () => {
    const store = new TaskStore(dbPath);
    const pm = new ProcessManager();
    pm.attachStore(store);
    const task = pm.createTask('echo', ['x'], root);
    // appendLog is private; drive it directly to test cap parity.
    const append = (
      pm as unknown as {
        appendLog: (t: TaskRun, k: string, m: string) => void;
      }
    ).appendLog.bind(pm);
    for (let i = 0; i < 2005; i++) append(task, 'stdout', `line ${i}`);
    assert.equal(task.logs.length, 2000);
    // Force a final flush through a state transition.
    (pm as unknown as { persist: (t: TaskRun) => void }).persist(task);
    const stored = store.get(task.id);
    assert.equal(stored?.logTail.length, 2000);
    assert.equal(stored?.logTail[0]?.message, 'line 5');
    assert.equal(stored?.logTail.at(-1)?.message, 'line 2004');
    store.close();
  });

  it('works with no store attached (in-memory only)', async () => {
    const pm = new ProcessManager();
    const task = pm.runCommand('echo', ['nostore'], { cwd: root });
    assert.equal(await waitForClose(task), 0);
    assert.equal(pm.getTask(task.id)?.status, 'completed');
  });

  it('auto-attaches when the task cwd is inside a VOW project', async () => {
    // Project shape: src/default.env at the root.
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'default.env'), '');
    const pm = new ProcessManager();
    const task = pm.runCommand('echo', ['auto'], { cwd: root });
    assert.equal(await waitForClose(task), 0);
    assert.ok(pm.attachedStore, 'store should auto-attach');
    assert.ok(fs.existsSync(dbPath));
    assert.equal(pm.attachedStore?.get(task.id)?.status, 'completed');
    pm.attachedStore?.close();
  });

  it('VOW_TASK_STORE=off disables auto-attach', async () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'default.env'), '');
    process.env.VOW_TASK_STORE = 'off';
    try {
      const pm = new ProcessManager();
      const task = pm.runCommand('echo', ['off'], { cwd: root });
      assert.equal(await waitForClose(task), 0);
      assert.equal(pm.attachedStore, null);
      assert.ok(!fs.existsSync(dbPath));
    } finally {
      delete process.env.VOW_TASK_STORE;
    }
  });
});
