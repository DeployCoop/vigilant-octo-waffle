import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Coverage guarantee for the WS4 error-envelope migration: a route
 * file may not return a raw `NextResponse.json({ error: ... })` —
 * errors go through `routeError` / `apiError` (lib/route-error.ts) so
 * every API error has the envelope shape
 * `{ error: { code, message, reason? } }`.
 *
 * The migration proceeds route group by route group; files that have
 * not migrated yet are listed in PENDING_MIGRATION. Each group PR
 * removes its files from the list. When the list is empty this test
 * guards the envelope permanently — a new raw error response in any
 * route (including a brand-new file) fails CI.
 */

const API_DIR = path.dirname(fileURLToPath(import.meta.url));

const RAW_ERROR_PATTERN = /NextResponse\.json\(\s*\{\s*error\s*:/;

/** Route files not yet migrated to the envelope (WS4, PRs 8b–8d). */
const PENDING_MIGRATION = new Set([
  'ai/diagnose/route.ts',
  'antigravity/route.ts',
  'apps/[id]/route.ts',
  'apps/custom/route.ts',
  'apps/route.ts',
  'argo/diff/route.ts',
  'argo/webhook/route.ts',
  'backups/route.ts',
  'builder/route.ts',
  'chaos/route.ts',
  'cluster/contexts/route.ts',
  'cluster/k3s/route.ts',
  'cluster/nodes/route.ts',
  'cluster/route.ts',
  'config/doctor/route.ts',
  'config/route.ts',
  'data/s3/route.ts',
  'data/sql/route.ts',
  'dns/route.ts',
  'export/route.ts',
  'finops/route.ts',
  'flux/route.ts',
  'health/route.ts',
  'helm/route.ts',
  'k8s/exec/route.ts',
  'k8s/logs/route.ts',
  'k8s/metrics/route.ts',
  'namespaces/route.ts',
  'namespaces/sync/route.ts',
  'network/route.ts',
  'profiles/route.ts',
  'remote/route.ts',
  'rollouts/route.ts',
  'security/route.ts',
  'storage/route.ts',
  'system/route.ts',
  'tasks/route.ts',
  'tasks/run/route.ts',
  'topology/route.ts',
  'traces/route.ts',
  'waffle/abort/route.ts',
  'waffle/route.ts',
  'waffle/run/route.ts',
  'waffle/sources/route.ts',
  'waffle/sync/route.ts',
]);

function collectRouteFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(path.join(dir, entry.name), rel));
    } else if (entry.name === 'route.ts') {
      out.push(rel);
    }
  }
  return out.sort();
}

describe('error envelope coverage (WS4)', () => {
  const files = collectRouteFiles(API_DIR);

  it('finds the route files', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('no migrated route returns a raw { error } response', () => {
    const offenders = files.filter(
      (rel) =>
        !PENDING_MIGRATION.has(rel) &&
        RAW_ERROR_PATTERN.test(fs.readFileSync(path.join(API_DIR, rel), 'utf-8'))
    );
    expect(offenders).toEqual([]);
  });

  it('pending list contains only files that still need migration', () => {
    // A file that no longer matches the raw pattern must leave the
    // pending list, so the list always reflects real remaining work.
    const stale = [...PENDING_MIGRATION].filter(
      (rel) =>
        !files.includes(rel) ||
        !RAW_ERROR_PATTERN.test(fs.readFileSync(path.join(API_DIR, rel), 'utf-8'))
    );
    expect(stale).toEqual([]);
  });
});
