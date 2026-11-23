/**
 * Studio wiring (Batch C, Phase 1): `executePostgresQuery` must error —
 * not fabricate rows — when no PostgreSQL pod exists.
 *
 * Environment assumption (same class as k8s.test.ts's offline probe):
 * the test environment has no `kubectl` binary and no postgres pod, so
 * every pod lookup comes back empty. If a future environment runs
 * these tests against a live cluster with a postgres pod, this test
 * no longer describes that environment and must be reworked.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executePostgresQuery, PostgresUnavailableError } from '../data.js';

describe('executePostgresQuery (no simulated fallback)', () => {
  it('throws PostgresUnavailableError instead of fabricated tables when no pod exists', async () => {
    await assert.rejects(
      executePostgresQuery('SELECT table_schema, table_name FROM information_schema.tables;'),
      (err: unknown) => err instanceof PostgresUnavailableError
    );
  });

  it('throws PostgresUnavailableError for a plain query too (no "Notice" row)', async () => {
    await assert.rejects(executePostgresQuery('SELECT 1;'), (err: unknown) => {
      assert.ok(err instanceof PostgresUnavailableError);
      assert.doesNotMatch(err.message, /Notice/);
      return true;
    });
  });
});
