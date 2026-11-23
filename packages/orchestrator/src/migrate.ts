import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { findProjectRoot } from './config.js';
import { K8sClient } from './k8s.js';
import { executePostgresQuery, PostgresUnavailableError, type QueryResult } from './data.js';
import { createVeleroBackup } from './backup.js';
import { ClusterUnavailableError } from './errors.js';
import { requireFound } from './studio-store.js';
import type { TaskRun } from './executor.js';

export interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: string | null;
  executionDurationMs: number;
  status: 'APPLIED' | 'PENDING' | 'FAILED';
  ddlChecksum: string;
}

export interface DdlLintFinding {
  rule: string;
  severity: 'BLOCKER' | 'WARNING' | 'INFO';
  message: string;
  line: number;
  suggestedFix: string;
}

/**
 * Studio wiring (Batch C): migrations are real files + real database
 * state. The four hardcoded records this module used to return are
 * gone; the same four migrations now live as SQL files under
 * `migrations/` at the project root, and applied state lives in the
 * `vow_migrations` tracking table in Postgres.
 *
 * Directory choice: `migrations/` at the project root (found via
 * `findProjectRoot()`, the same helper the config loader uses), so the
 * files sit next to `argo/`, `charts/`, and `flux/` — the operator's
 * other cluster sources of truth — and ship in the Docker image via
 * an explicit `COPY migrations/` in the builder stage (the Phase 0
 * lesson: root-level content is not in the image unless copied).
 * A missing directory is an empty migration list, not an error: a
 * fresh checkout legitimately has no migrations yet.
 *
 * File naming: `<version>_<name>.sql`, e.g.
 * `20260901_01_init_users_and_tenants.sql`. The version is the
 * `YYYYMMDD_NN` prefix; the name is the remainder. `ddlChecksum` is
 * the real SHA-256 of the file's current contents, so a file edited
 * after it was applied shows checksum drift instead of a stale hash.
 */

/** Directory (relative to the project root) holding migration files. */
export const MIGRATIONS_DIR_NAME = 'migrations';

/** Postgres table tracking which migrations have been applied. */
export const MIGRATION_TRACKING_TABLE = 'vow_migrations';

export interface MigrationFile {
  version: string;
  name: string;
  fileName: string;
  sql: string;
  ddlChecksum: string;
}

/** Injectable seams (same shape as ebpf's `*Deps`): tests stub the
 * cluster probe, the query layer, and the snapshot; production passes
 * nothing and gets the real implementations. */
export interface MigrateDeps {
  /** Override the migrations directory (tests point at a fixture dir). */
  migrationsDir?: string;
  /** Cluster probe override. Defaults to `new K8sClient().getTelemetry()`. */
  getTelemetry?: () => Promise<{ isConnected: boolean }>;
  /** Query-layer override. Defaults to `executePostgresQuery`. */
  executeQuery?: typeof executePostgresQuery;
  /** Snapshot override. Defaults to a real Velero backup (below). */
  createSnapshot?: (name: string) => Promise<{ code: number | null; stderr: string }>;
}

const MIGRATION_FILE_RE = /^(\d{8}_\d{2})_([a-z][a-z0-9_]*)\.sql$/;

/** Real SHA-256 of the migration file's contents. */
export function computeDdlChecksum(sql: string): string {
  return `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex')}`;
}

/** `<project root>/migrations`, via the shared root finder. */
export function resolveMigrationsDir(startDir: string = process.cwd()): string {
  return path.join(findProjectRoot(startDir), MIGRATIONS_DIR_NAME);
}

/** Discover migration files, sorted by version ascending. A missing
 * directory (or one with no matching files) is an empty list. */
export async function discoverMigrationFiles(
  migrationsDir: string = resolveMigrationsDir()
): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(migrationsDir);
  } catch {
    return [];
  }
  const files: MigrationFile[] = [];
  for (const fileName of entries.sort()) {
    const match = MIGRATION_FILE_RE.exec(fileName);
    if (!match) continue;
    const sql = await readFile(path.join(migrationsDir, fileName), 'utf8');
    files.push({
      version: match[1],
      name: match[2],
      fileName,
      sql,
      ddlChecksum: computeDdlChecksum(sql),
    });
  }
  files.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return files;
}

/** SQL string literal (filenames are regex-validated, but quote
 * defensively anyway — a quote in a value must never break the
 * tracking-table statement). */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface AppliedRow {
  version: string;
  name: string;
  appliedAt: string | null;
  executionDurationMs: number;
  status: MigrationRecord['status'];
  ddlChecksum: string;
}

async function ensureTrackingTable(
  executeQuery: NonNullable<MigrateDeps['executeQuery']>
): Promise<void> {
  await executeQuery(
    `CREATE TABLE IF NOT EXISTS ${MIGRATION_TRACKING_TABLE} (` +
      'version TEXT PRIMARY KEY, ' +
      'name TEXT NOT NULL, ' +
      'applied_at TIMESTAMPTZ, ' +
      'execution_duration_ms INTEGER NOT NULL DEFAULT 0, ' +
      "status TEXT NOT NULL DEFAULT 'PENDING', " +
      "ddl_checksum TEXT NOT NULL DEFAULT ''" +
      ')'
  );
}

/** Read the tracking table into a version-keyed map. Defensive about
 * `psql` output shape: `executePostgresQuery` passes psql's `(N rows)`
 * footer through as a one-cell row, so rows that do not match the
 * column count are dropped, and an unknown status coerces to PENDING. */
function parseAppliedRows(result: QueryResult): Map<string, AppliedRow> {
  const rows = new Map<string, AppliedRow>();
  const col = (name: string) => result.columns.indexOf(name);
  const iVersion = col('version');
  const iName = col('name');
  const iAppliedAt = col('applied_at');
  const iDuration = col('execution_duration_ms');
  const iStatus = col('status');
  const iChecksum = col('ddl_checksum');
  if ([iVersion, iName, iAppliedAt, iDuration, iStatus, iChecksum].some((i) => i < 0)) {
    throw new Error('vow_migrations query returned an unexpected shape');
  }
  for (const row of result.rows) {
    if (row.length !== result.columns.length) continue;
    const status = row[iStatus];
    rows.set(row[iVersion], {
      version: row[iVersion],
      name: row[iName],
      appliedAt: row[iAppliedAt] || null,
      executionDurationMs: Number.parseInt(row[iDuration], 10) || 0,
      status: status === 'APPLIED' || status === 'FAILED' || status === 'PENDING' ? status : 'PENDING',
      ddlChecksum: row[iChecksum],
    });
  }
  return rows;
}

async function readAppliedRows(
  executeQuery: NonNullable<MigrateDeps['executeQuery']>
): Promise<Map<string, AppliedRow>> {
  const result = await executeQuery(
    'SELECT version, name, applied_at, execution_duration_ms, status, ddl_checksum ' +
      `FROM ${MIGRATION_TRACKING_TABLE} ORDER BY version ASC`
  );
  return parseAppliedRows(result);
}

async function recordMigration(
  executeQuery: NonNullable<MigrateDeps['executeQuery']>,
  record: MigrationRecord
): Promise<void> {
  await executeQuery(
    `INSERT INTO ${MIGRATION_TRACKING_TABLE} ` +
      '(version, name, applied_at, execution_duration_ms, status, ddl_checksum) VALUES (' +
      `${sqlLiteral(record.version)}, ${sqlLiteral(record.name)}, ` +
      `${record.appliedAt ? sqlLiteral(record.appliedAt) : 'NULL'}, ` +
      `${record.executionDurationMs}, ${sqlLiteral(record.status)}, ${sqlLiteral(record.ddlChecksum)}) ` +
      'ON CONFLICT (version) DO UPDATE SET ' +
      'name = EXCLUDED.name, applied_at = EXCLUDED.applied_at, ' +
      'execution_duration_ms = EXCLUDED.execution_duration_ms, ' +
      'status = EXCLUDED.status, ddl_checksum = EXCLUDED.ddl_checksum'
  );
}

/** Fail unless the cluster is reachable (cached `getTelemetry()` probe). */
async function requireCluster(deps: MigrateDeps): Promise<void> {
  const getTelemetry = deps.getTelemetry ?? (async () => new K8sClient().getTelemetry());
  const telemetry = await getTelemetry();
  if (!telemetry.isConnected) {
    throw new ClusterUnavailableError(
      'Kubernetes cluster is unavailable: migrations cannot be listed without a cluster to read the database from.'
    );
  }
}

/** Translate a missing database into the shared no-cluster error;
 * every other query failure propagates unchanged. */
async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PostgresUnavailableError) {
      throw new ClusterUnavailableError(
        'PostgreSQL is unavailable: no postgres pod found in the cluster.'
      );
    }
    throw err;
  }
}

export async function getMigrationStatus(deps: MigrateDeps = {}): Promise<MigrationRecord[]> {
  await requireCluster(deps);
  const executeQuery = deps.executeQuery ?? executePostgresQuery;
  const files = await discoverMigrationFiles(deps.migrationsDir);
  const applied = await withDb(async () => {
    await ensureTrackingTable(executeQuery);
    return readAppliedRows(executeQuery);
  });
  const records: MigrationRecord[] = [];
  for (const file of files) {
    const row = applied.get(file.version);
    records.push({
      version: file.version,
      name: file.name,
      appliedAt: row?.appliedAt ?? null,
      executionDurationMs: row?.executionDurationMs ?? 0,
      status: row?.status ?? 'PENDING',
      // Always the hash of the file's CURRENT contents: a file edited
      // after it was applied shows checksum drift against the stored
      // row instead of a stale hash.
      ddlChecksum: file.ddlChecksum,
    });
    applied.delete(file.version);
  }
  // Rows whose file is gone keep their history (stored checksum and
  // status) instead of silently disappearing from the timeline.
  for (const row of applied.values()) {
    records.push({
      version: row.version,
      name: row.name,
      appliedAt: row.appliedAt,
      executionDurationMs: row.executionDurationMs,
      status: row.status,
      ddlChecksum: row.ddlChecksum,
    });
  }
  records.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return records;
}

/**
 * Strip SQL comments and string/identifier literals for linting (Batch C, C8).
 * A char-by-char state machine blanks out line comments, nested block
 * comments, single-quoted strings (two quotes is an escaped quote),
 * double-quoted identifiers, and dollar-quoted strings
 * (dollar-tag-dollar ... dollar-tag-dollar), replacing stripped
 * characters with spaces — except newlines, which are kept so line
 * numbers stay aligned with the input.
 */
function stripSqlCommentsAndLiterals(sql: string): string {
  const out: string[] = [];
  let i = 0;
  const n = sql.length;

  const pushSpaces = (from: number, to: number) => {
    for (let j = from; j < to; j++) out.push(sql[j] === '\n' ? '\n' : ' ');
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1] ?? '';

    // -- line comment
    if (ch === '-' && next === '-') {
      const start = i;
      i += 2;
      while (i < n && sql[i] !== '\n') i++;
      pushSpaces(start, i);
      continue;
    }

    // /* block comment (nested, per PostgreSQL) */
    if (ch === '/' && next === '*') {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      pushSpaces(start, i);
      continue;
    }

    // 'single-quoted string', '' is an escaped quote
    if (ch === "'") {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      pushSpaces(start, i);
      continue;
    }

    // "double-quoted identifier", "" is an escaped quote
    if (ch === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      pushSpaces(start, i);
      continue;
    }

    // $tag$ dollar-quoted string (including bare $$)
    if (ch === '$') {
      const tagMatch = /^\$[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*\$|^\$\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const start = i;
        const closeIdx = sql.indexOf(tag, i + tag.length);
        i = closeIdx === -1 ? n : closeIdx + tag.length;
        pushSpaces(start, i);
        continue;
      }
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}

/**
 * Split stripped SQL into statements on `;`, keeping each statement's
 * start line (the line of its first token) and its `[start, end)`
 * offsets. Stripping preserves the input length exactly (stripped
 * characters become spaces, newlines are kept), so the offsets line
 * up 1:1 with the ORIGINAL sql — execution slices the original text
 * at those offsets (literals intact), while linting reads `text`
 * (comments/literals blanked). Executing statement-by-statement also
 * keeps `CREATE INDEX CONCURRENTLY` working: a whole file sent as one
 * `psql -c` invocation runs inside an implicit transaction, which
 * CONCURRENTLY refuses.
 */
function splitSqlStatements(stripped: string): Array<{
  text: string;
  start: number;
  end: number;
  startLine: number;
}> {
  const lineOf = (index: number): number => {
    let line = 1;
    for (let i = 0; i < index; i++) if (stripped[i] === '\n') line++;
    return line;
  };
  const statements: Array<{ text: string; start: number; end: number; startLine: number }> = [];
  let stmtStart = 0;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === ';') {
      const text = stripped.slice(stmtStart, i);
      const firstNonSpace = text.search(/\S/);
      if (firstNonSpace !== -1) {
        statements.push({ text, start: stmtStart, end: i, startLine: lineOf(stmtStart + firstNonSpace) });
      }
      stmtStart = i + 1;
    }
  }
  const tail = stripped.slice(stmtStart);
  const firstNonSpace = tail.search(/\S/);
  if (firstNonSpace !== -1) {
    statements.push({ text: tail, start: stmtStart, end: stripped.length, startLine: lineOf(stmtStart + firstNonSpace) });
  }
  return statements;
}

/** Split a migration file into its executable statements (original
 * text, literals intact), one `psql -c` invocation each. */
function splitExecutableStatements(sql: string): string[] {
  const stripped = stripSqlCommentsAndLiterals(sql);
  return splitSqlStatements(stripped)
    .map(({ start, end }) => sql.slice(start, end).trim())
    .filter((s) => s.length > 0);
}

export async function lintDdlScript(sql: string): Promise<{ clean: boolean; findings: DdlLintFinding[] }> {
  const findings: DdlLintFinding[] = [];
  // C8: lint statement-level over comment/string-stripped SQL, so a
  // multi-line CREATE INDEX trips BLOCKER while DDL inside comments or
  // string literals does not false-positive.
  const stripped = stripSqlCommentsAndLiterals(sql);

  for (const { text, startLine } of splitSqlStatements(stripped)) {
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;

    // Check 1: CREATE INDEX without CONCURRENTLY
    if (/CREATE\s+INDEX\s+/i.test(trimmed) && !/CONCURRENTLY/i.test(trimmed)) {
      findings.push({
        rule: 'require-concurrent-index-creation',
        severity: 'BLOCKER',
        message: 'CREATE INDEX takes an exclusive ACCESS EXCLUSIVE table lock on PostgreSQL.',
        line: startLine,
        suggestedFix: trimmed.replace(/CREATE\s+INDEX/i, 'CREATE INDEX CONCURRENTLY'),
      });
    }

    // Check 2: DROP COLUMN
    if (/\bALTER\s+TABLE\b/i.test(trimmed) && /\bDROP\s+COLUMN\b/i.test(trimmed)) {
      findings.push({
        rule: 'avoid-immediate-column-drop',
        severity: 'WARNING',
        message: 'Dropping a column immediately causes 500 errors on running app replicas still referencing it.',
        line: startLine,
        suggestedFix: '-- Step 1: Deprecate in code\n-- Step 2: Set as NULLABLE\n-- Step 3: Drop in subsequent release',
      });
    }

    // Check 3: ADD COLUMN with volatile default
    if (
      /\bALTER\s+TABLE\b/i.test(trimmed) &&
      /\bADD\s+COLUMN\b/i.test(trimmed) &&
      /\bDEFAULT\b/i.test(trimmed) &&
      !/uuid_generate|now\(\)/i.test(trimmed)
    ) {
      findings.push({
        rule: 'verify-non-volatile-default',
        severity: 'INFO',
        message: 'Ensure DEFAULT expression is non-volatile to prevent PostgreSQL full table rewrites.',
        line: startLine,
        suggestedFix: 'PostgreSQL 11+ supports instant ADD COLUMN with constant defaults.',
      });
    }
  }

  return {
    clean: findings.filter((f) => f.severity === 'BLOCKER').length === 0,
    findings,
  };
}

export interface MigrationExecutionResult {
  success: boolean;
  executedVersion: string;
  message: string;
  /**
   * Present on failure so the route can map the status instead of
   * collapsing every failure to one code: not_found → 404,
   * blocked → 400, failed → 500.
   */
  errorKind?: 'not_found' | 'blocked' | 'failed';
}

/** First line of a multi-line error, for result messages: the full
 * psql stderr belongs in the server log, not in an API response. */
function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

/** Await a Velero TaskRun's terminal state. `runCommand` emits
 * 'close' exactly once; a task that already finalized (synchronous
 * spawn failure) reports its exit code directly, since no listener
 * would ever fire. */
async function awaitTaskClose(task: TaskRun): Promise<number | null> {
  if (task.status !== 'running') return task.exitCode ?? null;
  return new Promise<number | null>((resolve) => {
    task.emitter.once('close', (code: number | null) => resolve(code));
  });
}

/**
 * Pre-migration snapshot via Velero. `velero backup create` returns
 * once the Backup object exists (it does not wait for the backup to
 * finish uploading), so awaiting the task means "snapshot requested
 * and accepted", not "snapshot complete" — the message says so.
 * No --include-namespaces: the backup covers the whole cluster, so
 * the postgres namespace is included whichever one it lives in.
 */
async function defaultCreateSnapshot(name: string): Promise<{ code: number | null; stderr: string }> {
  const task = createVeleroBackup(name);
  const code = await awaitTaskClose(task);
  const stderr = task.logs
    .filter((l) => l.type === 'stderr')
    .map((l) => l.message)
    .join('');
  return { code, stderr };
}

export async function executeZeroDowntimeMigration(
  version: string,
  deps: MigrateDeps = {}
): Promise<MigrationExecutionResult> {
  await requireCluster(deps);
  const executeQuery = deps.executeQuery ?? executePostgresQuery;
  const createSnapshot = deps.createSnapshot ?? defaultCreateSnapshot;
  const files = await discoverMigrationFiles(deps.migrationsDir);
  // C4: an unknown version is a miss, never another migration's file.
  const file = requireFound(files, (f) => f.version === version);
  if (!file) {
    return {
      success: false,
      executedVersion: version,
      errorKind: 'not_found',
      message: `Migration version ${version} not found.`,
    };
  }

  // B6 (unchanged): no migration executes without a clean lint — now
  // linting the migration file's own DDL, not caller-supplied SQL, so
  // the recorded checksum always matches what actually ran.
  const lintResult = await lintDdlScript(file.sql);
  const blockers = lintResult.findings.filter((f) => f.severity === 'BLOCKER');
  if (blockers.length > 0) {
    return {
      success: false,
      executedVersion: version,
      errorKind: 'blocked',
      message: `Migration blocked: ${blockers.length} BLOCKER lint finding(s): ${blockers
        .map((f) => f.message)
        .join('; ')}`,
    };
  }

  // Refuse to re-apply an already-applied version, and refuse when the
  // file changed since it was applied (checksum drift) — re-running
  // DDL blindly is how zero-downtime rollouts become outages.
  const applied = await withDb(async () => {
    await ensureTrackingTable(executeQuery);
    return readAppliedRows(executeQuery);
  });
  const existing = applied.get(version);
  if (existing?.status === 'APPLIED') {
    if (existing.ddlChecksum !== file.ddlChecksum) {
      return {
        success: false,
        executedVersion: version,
        errorKind: 'blocked',
        message: `Migration ${version} is already APPLIED but its file changed since (checksum drift); refusing to re-run.`,
      };
    }
    return {
      success: false,
      executedVersion: version,
      errorKind: 'blocked',
      message: `Migration ${version} is already APPLIED.`,
    };
  }

  // Pre-migration snapshot, fail-closed: the studio promises a
  // checkpoint before DDL runs, so a snapshot that cannot even be
  // requested (velero missing, API unreachable) aborts the migration
  // instead of running DDL unprotected.
  const snapshotName = `vow-migrate-${version}-${Date.now()}`;
  const snapshot = await createSnapshot(snapshotName);
  if (snapshot.code !== 0) {
    const detail = firstLine(snapshot.stderr);
    return {
      success: false,
      executedVersion: version,
      errorKind: 'failed',
      message:
        `Pre-migration Velero snapshot failed (exit code ${snapshot.code})` +
        `${detail ? `: ${detail}` : ''}; migration not executed.`,
    };
  }

  // Execute the file's DDL statement-by-statement (one `psql -c`
  // invocation each) and measure the real psql time. Per-statement
  // execution stops at the first failure — a whole file sent as one
  // `psql -c` would keep going after an error — and it keeps
  // `CREATE INDEX CONCURRENTLY` working (one invocation runs inside
  // an implicit transaction, which CONCURRENTLY refuses). Statements
  // are not wrapped in a transaction, so a mid-file failure can leave
  // earlier statements applied. That is the honest FAILED state; the
  // operator fixes the file and retries.
  const statements = splitExecutableStatements(file.sql);
  const startedAt = Date.now();
  try {
    for (const statement of statements) {
      await withDb(() => executeQuery(statement));
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    // A vanished database rethrows as ClusterUnavailableError; a psql
    // failure records FAILED and returns the failure.
    if (err instanceof ClusterUnavailableError) throw err;
    await recordMigration(executeQuery, {
      version,
      name: file.name,
      appliedAt: null,
      executionDurationMs: durationMs,
      status: 'FAILED',
      ddlChecksum: file.ddlChecksum,
    }).catch(() => {
      // Best-effort: the failure is already being reported, and a
      // missing row just leaves the version PENDING on the next load
      // instead of FAILED.
    });
    const detail = err instanceof Error ? err.message : 'unknown error';
    return {
      success: false,
      executedVersion: version,
      errorKind: 'failed',
      message: `Migration ${version} failed after ${durationMs}ms: ${firstLine(detail)}`,
    };
  }
  const durationMs = Date.now() - startedAt;
  // A tracking write that fails here throws: the DDL applied but the
  // record is missing, and the next load would wrongly offer a retry.
  await withDb(() =>
    recordMigration(executeQuery, {
      version,
      name: file.name,
      appliedAt: new Date().toISOString(),
      executionDurationMs: durationMs,
      status: 'APPLIED',
      ddlChecksum: file.ddlChecksum,
    })
  );
  return {
    success: true,
    executedVersion: version,
    message: `Pre-migration Velero snapshot ${snapshotName} created. Migration [${file.name}] applied in ${durationMs}ms.`,
  };
}
