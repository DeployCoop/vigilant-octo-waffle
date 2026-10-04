/**
 * Persistent task records (improvements plan WS5).
 *
 * Background-task *records* live in SQLite at
 * `<projectRoot>/.vow/state.db` via `node:sqlite` (flag-free on
 * Node 24, zero new dependencies), next to the authz store and audit
 * log. The process manager keeps live tasks in memory and writes
 * through to this store on state transitions; reads merge memory
 * (live) with the DB (history), so a web-process restart no longer
 * orphans task history.
 *
 * Only records persist. PTY exec sessions and streams hold live OS
 * resources and stay ephemeral by design (plan §8.4).
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskLogEntry, TaskRun } from './executor.js';

export type TaskStatus = TaskRun['status'];

export interface TaskRecord {
  id: string;
  label: string;
  kind: string;
  status: TaskStatus;
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  logTail: TaskLogEntry[];
  meta: Record<string, unknown>;
}

const SCHEMA_VERSION = 1;

export class TaskStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch {
      // Best effort: the file lives under the already-private .vow/.
    }
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        pid INTEGER,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        exit_code INTEGER,
        log_tail TEXT NOT NULL DEFAULT '[]',
        meta TEXT NOT NULL DEFAULT '{}'
      )
    `);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  /** Insert or replace the record for a task (write-through). */
  upsert(record: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, label, kind, status, pid, started_at, ended_at, exit_code, log_tail, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           status = excluded.status,
           pid = excluded.pid,
           ended_at = excluded.ended_at,
           exit_code = excluded.exit_code,
           log_tail = excluded.log_tail,
           meta = excluded.meta`
      )
      .run(
        record.id,
        record.label,
        record.kind,
        record.status,
        record.pid,
        record.startedAt,
        record.endedAt,
        record.exitCode,
        JSON.stringify(record.logTail),
        JSON.stringify(record.meta)
      );
  }

  get(id: string): TaskRecord | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** All records, newest first. */
  list(): TaskRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks ORDER BY started_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  /**
   * Startup reconciliation: rows still marked `running` from a
   * previous process are honest history, not live tasks. A row whose
   * pid no longer exists becomes `interrupted` with ended_at set; a
   * row whose pid is alive stays `running` (the process genuinely
   * outlived the server; it is re-attached as read-only history).
   * Returns the reconciled (interrupted) records.
   */
  reconcileRunning(now = new Date().toISOString()): TaskRecord[] {
    const running = this.db
      .prepare("SELECT * FROM tasks WHERE status = 'running'")
      .all() as Record<string, unknown>[];
    const interrupted: TaskRecord[] = [];
    const mark = this.db.prepare(
      "UPDATE tasks SET status = 'interrupted', ended_at = ? WHERE id = ?"
    );
    for (const row of running) {
      const record = rowToRecord(row);
      if (record.pid !== null && pidAlive(record.pid)) continue;
      mark.run(now, record.id);
      interrupted.push({ ...record, status: 'interrupted', endedAt: now });
    }
    return interrupted;
  }

  close(): void {
    this.db.close();
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function rowToRecord(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    kind: String(row.kind),
    status: String(row.status) as TaskStatus,
    pid: row.pid === null ? null : Number(row.pid),
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null ? null : String(row.ended_at),
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    logTail: JSON.parse(String(row.log_tail)) as TaskLogEntry[],
    meta: JSON.parse(String(row.meta)) as Record<string, unknown>,
  };
}

/** The on-disk location of the task store for a project. */
export function taskStorePath(projectRoot: string): string {
  return path.join(projectRoot, '.vow', 'state.db');
}

/** Build the persisted record for a live task. */
export function taskToRecord(task: TaskRun): TaskRecord {
  return {
    id: task.id,
    label: `${task.command} ${task.args.join(' ')}`.trim(),
    kind: 'command',
    status: task.status,
    pid: task.childProcess?.pid ?? null,
    startedAt: task.startedAt,
    endedAt: task.finishedAt ?? null,
    exitCode: task.exitCode ?? null,
    logTail: task.logs,
    meta: { cwd: task.cwd, command: task.command, args: task.args },
  };
}
