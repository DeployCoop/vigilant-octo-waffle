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

/** Route files not yet migrated to the envelope. Empty: WS4 migration complete (PRs 8a–8d). */
const PENDING_MIGRATION = new Set<string>([]);

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
