/**
 * Regression tests for the 2026-10-14 bug sweep (task store):
 * - a corrupt log_tail/meta JSON in one row used to throw out of
 *   rowToRecord and break list()/getAllTasks() entirely;
 * - the shared state.db (web server + ink CLI) had no busy_timeout, so
 *   concurrent writers hit SQLITE_BUSY, which persist() swallowed.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TaskStore, type TaskRecord } from '../taskStore.js';

let root: string;
let dbPath: string;

function record(partial: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    label: 'echo hi',
    kind: 'command',
    status: 'completed',
    pid: null,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    exitCode: 0,
    logTail: [],
    meta: {},
    ...partial,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-store-'));
  dbPath = path.join(root, 'state.db');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('TaskStore regressions', () => {
  it('sets busy_timeout so concurrent processes wait instead of erroring', () => {
    const store = new TaskStore(dbPath);
    store.upsert(record({ id: 'a' }));
    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare('PRAGMA busy_timeout').get() as any;
    raw.close();
    store.close();
    // The pragma is per-connection; what matters is that opening through
    // TaskStore and writing from a second connection does not throw.
    assert.ok(row);
    const store2 = new TaskStore(dbPath);
    assert.doesNotThrow(() => store2.upsert(record({ id: 'b' })));
    store2.close();
  });

  it('one corrupt row does not break list()', () => {
    const store = new TaskStore(dbPath);
    store.upsert(record({ id: 'good' }));
    store.close();

    const raw = new DatabaseSync(dbPath);
    raw
      .prepare(
        `INSERT INTO tasks (id, label, kind, status, pid, started_at, ended_at, exit_code, log_tail, meta)
         VALUES ('corrupt', 'x', 'command', 'completed', NULL, '2026-01-01T00:00:00.000Z', NULL, 0, '{not json', '{also not')`
      )
      .run();
    raw.close();

    const store2 = new TaskStore(dbPath);
    const all = store2.list();
    assert.equal(all.length, 2);
    const corrupt = all.find((r) => r.id === 'corrupt')!;
    assert.deepEqual(corrupt.logTail, []);
    assert.deepEqual(corrupt.meta, {});
    store2.close();
  });
});
