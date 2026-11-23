/**
 * Studio wiring (Batch C, Phase 1): migrate against real files + a real
 * tracking table. The query layer, the cluster probe, and the snapshot
 * are stubbed through the `MigrateDeps` seam; the fake below is a
 * faithful stand-in for `psql -c` over `vow_migrations` — it answers
 * the tracking-table statements and records every migration statement
 * executed, so the tests pin that migrate discovers real files, hashes
 * them, lints them, snapshots first, executes via the real path,
 * measures duration, and surfaces errors. No test asserts on
 * fabricated values.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getMigrationStatus,
  executeZeroDowntimeMigration,
  computeDdlChecksum,
  discoverMigrationFiles,
  type MigrateDeps,
} from '../migrate.js';
import { PostgresUnavailableError, type QueryResult } from '../data.js';
import { ClusterUnavailableError } from '../errors.js';

interface FakeRow {
  version: string;
  name: string;
  applied_at: string | null;
  execution_duration_ms: number;
  status: 'APPLIED' | 'PENDING' | 'FAILED';
  ddl_checksum: string;
}

/** In-memory stand-in for psql over the tracking table. */
function makeFakeDb(initialRows: FakeRow[] = []) {
  const rows = new Map<string, FakeRow>(initialRows.map((r) => [r.version, { ...r }]));
  /** Every non-tracking statement executed, in order. */
  const executed: string[] = [];
  /** Snapshot requests, in order. */
  const snapshots: string[] = [];
  let failQuery: ((sql: string) => Error | null) | null = null;

  const executeQuery = async (sql: string): Promise<QueryResult> => {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();
    if (trimmed.includes('vow_migrations') && upper.startsWith('CREATE TABLE')) {
      return { columns: [], rows: [], rowCount: 0, executionTimeMs: 0 };
    }
    if (trimmed.includes('vow_migrations') && upper.startsWith('SELECT')) {
      const data = [...rows.values()].sort((a, b) => (a.version < b.version ? -1 : 1));
      // Mirror executePostgresQuery's real parsing: psql's "(N rows)"
      // footer arrives as a one-cell row.
      return {
        columns: ['version', 'name', 'applied_at', 'execution_duration_ms', 'status', 'ddl_checksum'],
        rows: [
          ...data.map((r) => [
            r.version,
            r.name,
            r.applied_at ?? '',
            String(r.execution_duration_ms),
            r.status,
            r.ddl_checksum,
          ]),
          [`(${data.length} rows)`],
        ],
        rowCount: data.length,
        executionTimeMs: 0,
      };
    }
    if (trimmed.includes('vow_migrations') && upper.startsWith('INSERT')) {
      const m =
        /VALUES \('([^']*)', '([^']*)', (NULL|'[^']*'), (\d+), '([^']*)', '([^']*)'\)/.exec(trimmed);
      assert.ok(m, `fake db could not parse tracking upsert: ${trimmed}`);
      const [, version, name, appliedAt, durationMs, status, checksum] = m;
      rows.set(version, {
        version,
        name,
        applied_at: appliedAt === 'NULL' ? null : appliedAt.slice(1, -1),
        execution_duration_ms: Number.parseInt(durationMs, 10),
        status: status as FakeRow['status'],
        ddl_checksum: checksum,
      });
      return { columns: [], rows: [], rowCount: 0, executionTimeMs: 0 };
    }
    const failure = failQuery?.(trimmed) ?? null;
    if (failure) throw failure;
    executed.push(trimmed);
    return { columns: [], rows: [], rowCount: 0, executionTimeMs: 0 };
  };

  return {
    rows,
    executed,
    snapshots,
    setFailQuery(fn: ((sql: string) => Error | null) | null) {
      failQuery = fn;
    },
    deps(overrides: Partial<MigrateDeps> = {}): MigrateDeps {
      return {
        getTelemetry: async () => ({ isConnected: true }),
        executeQuery,
        createSnapshot: async (name: string) => {
          snapshots.push(name);
          return { code: 0, stderr: '' };
        },
        ...overrides,
      };
    },
  };
}

const CLEAN_TABLE = 'CREATE TABLE IF NOT EXISTS users (id INT);';
const CLEAN_COLUMN =
  "ALTER TABLE users ADD COLUMN status VARCHAR(32) DEFAULT 'pending';";
const BLOCKER_INDEX = 'CREATE INDEX idx_users_email ON users (email);';
const SEMICOLON_LITERAL =
  "ALTER TABLE users ADD COLUMN note TEXT DEFAULT 'a;b';";

let dir = '';

function writeFixtures(files: Record<string, string>): string {
  dir = mkdtempSync(path.join(tmpdir(), 'vow-migrate-'));
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), sql);
  }
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('discoverMigrationFiles', () => {
  it('discovers <version>_<name>.sql files sorted by version with real checksums', async () => {
    const d = writeFixtures({
      '20260920_03_add_column.sql': CLEAN_COLUMN,
      '20260901_01_init_users.sql': CLEAN_TABLE,
      'README.md': 'not a migration',
      '20260901_01_init_users.sql.bak': CLEAN_TABLE,
    });
    const files = await discoverMigrationFiles(d);
    assert.deepEqual(
      files.map((f) => [f.version, f.name]),
      [
        ['20260901_01', 'init_users'],
        ['20260920_03', 'add_column'],
      ]
    );
    assert.equal(files[0].ddlChecksum, computeDdlChecksum(CLEAN_TABLE));
    assert.equal(files[0].sql, CLEAN_TABLE);
  });

  it('returns [] for a missing directory', async () => {
    assert.deepEqual(await discoverMigrationFiles('/definitely/not/a/dir'), []);
  });
});

describe('getMigrationStatus', () => {
  it('lists discovered files as PENDING with file hashes when the table is empty', async () => {
    const d = writeFixtures({
      '20260901_01_init_users.sql': CLEAN_TABLE,
      '20260920_03_add_column.sql': CLEAN_COLUMN,
    });
    const db = makeFakeDb();
    const status = await getMigrationStatus({ ...db.deps(), migrationsDir: d });
    assert.deepEqual(
      status.map((m) => [m.version, m.name, m.status, m.appliedAt, m.executionDurationMs]),
      [
        ['20260901_01', 'init_users', 'PENDING', null, 0],
        ['20260920_03', 'add_column', 'PENDING', null, 0],
      ]
    );
    assert.equal(status[0].ddlChecksum, computeDdlChecksum(CLEAN_TABLE));
  });

  it('carries appliedAt/duration from the tracking row, checksum from the file', async () => {
    const d = writeFixtures({ '20260901_01_init_users.sql': CLEAN_TABLE });
    const db = makeFakeDb([
      {
        version: '20260901_01',
        name: 'init_users',
        applied_at: '2026-09-02T00:00:00.000Z',
        execution_duration_ms: 123,
        status: 'APPLIED',
        ddl_checksum: computeDdlChecksum(CLEAN_TABLE),
      },
    ]);
    const [record] = await getMigrationStatus({ ...db.deps(), migrationsDir: d });
    assert.equal(record.status, 'APPLIED');
    assert.equal(record.appliedAt, '2026-09-02T00:00:00.000Z');
    assert.equal(record.executionDurationMs, 123);
  });

  it('keeps an orphan applied row (file gone) with its stored values', async () => {
    const d = writeFixtures({ '20260901_01_init_users.sql': CLEAN_TABLE });
    const db = makeFakeDb([
      {
        version: '20260801_01',
        name: 'old_removed',
        applied_at: '2026-08-02T00:00:00.000Z',
        execution_duration_ms: 9,
        status: 'APPLIED',
        ddl_checksum: 'sha256:stored',
      },
    ]);
    const status = await getMigrationStatus({ ...db.deps(), migrationsDir: d });
    assert.deepEqual(
      status.map((m) => m.version),
      ['20260801_01', '20260901_01']
    );
    assert.equal(status[0].ddlChecksum, 'sha256:stored');
  });

  it('throws ClusterUnavailableError when the cluster is down', async () => {
    const d = writeFixtures({ '20260901_01_init_users.sql': CLEAN_TABLE });
    const db = makeFakeDb();
    await assert.rejects(
      getMigrationStatus({
        ...db.deps({ getTelemetry: async () => ({ isConnected: false }) }),
        migrationsDir: d,
      }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });

  it('translates a missing database into ClusterUnavailableError', async () => {
    const d = writeFixtures({ '20260901_01_init_users.sql': CLEAN_TABLE });
    const db = makeFakeDb();
    await assert.rejects(
      getMigrationStatus({
        ...db.deps({
          executeQuery: async () => {
            throw new PostgresUnavailableError();
          },
        }),
        migrationsDir: d,
      }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
  });
});

describe('executeZeroDowntimeMigration', () => {
  it('snapshots first, executes the file DDL, records APPLIED with a measured duration', async () => {
    const d = writeFixtures({ '20260920_03_add_column.sql': CLEAN_COLUMN });
    const db = makeFakeDb();
    const result = await executeZeroDowntimeMigration('20260920_03', {
      ...db.deps(),
      migrationsDir: d,
    });
    assert.equal(result.success, true);
    assert.equal(result.executedVersion, '20260920_03');
    assert.match(result.message, /Velero snapshot vow-migrate-20260920_03-/);
    assert.match(result.message, /applied in \d+ms/);
    assert.equal(db.snapshots.length, 1);
    // Statements execute without their trailing ';' (the splitter
    // slices [start, end) at the semicolon offset).
    assert.deepEqual(db.executed, [CLEAN_COLUMN.slice(0, -1)]);
    const row = db.rows.get('20260920_03');
    assert.ok(row);
    assert.equal(row.status, 'APPLIED');
    assert.ok(row.applied_at);
    assert.equal(row.ddl_checksum, computeDdlChecksum(CLEAN_COLUMN));
    assert.ok(row.execution_duration_ms >= 0);
  });

  it('executes a semicolon inside a string literal as one statement, intact', async () => {
    const d = writeFixtures({ '20260928_04_seed.sql': SEMICOLON_LITERAL });
    const db = makeFakeDb();
    const result = await executeZeroDowntimeMigration('20260928_04', {
      ...db.deps(),
      migrationsDir: d,
    });
    assert.equal(result.success, true);
    assert.deepEqual(db.executed, [SEMICOLON_LITERAL.slice(0, -1)]);
  });

  it('refuses an unknown version without snapshotting or executing', async () => {
    const d = writeFixtures({ '20260901_01_init_users.sql': CLEAN_TABLE });
    const db = makeFakeDb();
    const result = await executeZeroDowntimeMigration('20990101_99', {
      ...db.deps(),
      migrationsDir: d,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorKind, 'not_found');
    assert.equal(db.snapshots.length, 0);
    assert.deepEqual(db.executed, []);
  });

  it('refuses BLOCKER DDL without snapshotting or executing', async () => {
    const d = writeFixtures({ '20260910_02_add_index.sql': BLOCKER_INDEX });
    const db = makeFakeDb();
    const result = await executeZeroDowntimeMigration('20260910_02', {
      ...db.deps(),
      migrationsDir: d,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorKind, 'blocked');
    assert.match(result.message, /BLOCKER/);
    assert.equal(db.snapshots.length, 0);
    assert.deepEqual(db.executed, []);
  });

  it('refuses an already-APPLIED version, and a drifted file', async () => {
    const d = writeFixtures({ '20260901_01_init_users.sql': CLEAN_TABLE });
    const db = makeFakeDb([
      {
        version: '20260901_01',
        name: 'init_users',
        applied_at: '2026-09-02T00:00:00.000Z',
        execution_duration_ms: 42,
        status: 'APPLIED',
        ddl_checksum: computeDdlChecksum(CLEAN_TABLE),
      },
    ]);
    const applied = await executeZeroDowntimeMigration('20260901_01', {
      ...db.deps(),
      migrationsDir: d,
    });
    assert.equal(applied.success, false);
    assert.equal(applied.errorKind, 'blocked');
    assert.match(applied.message, /already APPLIED/);
    assert.equal(db.snapshots.length, 0);

    // Same version, file edited after apply: checksum drift refuses too.
    writeFileSync(path.join(d, '20260901_01_init_users.sql'), `${CLEAN_TABLE}\n-- edited\n`);
    const drifted = await executeZeroDowntimeMigration('20260901_01', {
      ...db.deps(),
      migrationsDir: d,
    });
    assert.equal(drifted.success, false);
    assert.equal(drifted.errorKind, 'blocked');
    assert.match(drifted.message, /checksum drift/);
    assert.equal(db.snapshots.length, 0);
    assert.deepEqual(db.executed, []);
  });

  it('records FAILED and reports the first psql error line when DDL fails', async () => {
    const d = writeFixtures({ '20260920_03_add_column.sql': CLEAN_COLUMN });
    const db = makeFakeDb();
    db.setFailQuery((sql) =>
      sql.includes('ALTER TABLE')
        ? new Error('psql: error: relation "users" does not exist\nLINE 1: ALTER TABLE users...')
        : null
    );
    const result = await executeZeroDowntimeMigration('20260920_03', {
      ...db.deps(),
      migrationsDir: d,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorKind, 'failed');
    assert.match(result.message, /relation "users" does not exist/);
    assert.doesNotMatch(result.message, /LINE 1/);
    assert.equal(db.snapshots.length, 1);
    const row = db.rows.get('20260920_03');
    assert.ok(row);
    assert.equal(row.status, 'FAILED');
    assert.equal(row.applied_at, null);
  });

  it('aborts before any DDL when the snapshot fails', async () => {
    const d = writeFixtures({ '20260920_03_add_column.sql': CLEAN_COLUMN });
    const db = makeFakeDb();
    const result = await executeZeroDowntimeMigration('20260920_03', {
      ...db.deps({
        createSnapshot: async (name: string) => {
          db.snapshots.push(name);
          return { code: 1, stderr: 'velero: command not found' };
        },
      }),
      migrationsDir: d,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorKind, 'failed');
    assert.match(result.message, /snapshot failed/);
    assert.match(result.message, /velero: command not found/);
    assert.deepEqual(db.executed, []);
    assert.equal(db.rows.has('20260920_03'), false);
  });

  it('throws ClusterUnavailableError when the cluster is down', async () => {
    const d = writeFixtures({ '20260920_03_add_column.sql': CLEAN_COLUMN });
    const db = makeFakeDb();
    await assert.rejects(
      executeZeroDowntimeMigration('20260920_03', {
        ...db.deps({ getTelemetry: async () => ({ isConnected: false }) }),
        migrationsDir: d,
      }),
      (err: unknown) => err instanceof ClusterUnavailableError
    );
    assert.equal(db.snapshots.length, 0);
  });
});
