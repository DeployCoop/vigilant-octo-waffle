import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Coverage guarantee for the authz rollout: every API route file must
 * consult the authorization layer (directly or via a wrapper), except
 * the routes on the explicit public allowlist. Adding a new route
 * without a guard fails this test — that is the point.
 */

const API_DIR = path.dirname(fileURLToPath(import.meta.url));

const GUARD_MARKERS = [
  'authorizeRequest',
  'withAuthz',
  'resolveAuthzContext',
  'authorizeWebhookRequest',
];

/** Routes that are deliberately reachable without authorization. */
const PUBLIC_ROUTES = new Set([
  // Liveness/readiness probe; exposes no project data.
  'health/route.ts',
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

describe('API route authorization coverage', () => {
  const routes = collectRouteFiles(API_DIR);

  it('finds the route tree', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('every non-public route consults the authz layer', () => {
    const unguarded = routes.filter((rel) => {
      if (PUBLIC_ROUTES.has(rel)) return false;
      const source = fs.readFileSync(path.join(API_DIR, rel), 'utf-8');
      return !GUARD_MARKERS.some((marker) => source.includes(marker));
    });
    expect(unguarded).toEqual([]);
  });

  it('the public allowlist stays accurate', () => {
    for (const rel of PUBLIC_ROUTES) {
      const file = path.join(API_DIR, rel);
      expect(fs.existsSync(file), rel).toBe(true);
      const source = fs.readFileSync(file, 'utf-8');
      // If a public route gains a guard, it no longer belongs here.
      expect(
        GUARD_MARKERS.some((marker) => source.includes(marker)),
        rel
      ).toBe(false);
    }
  });
});
