import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isValidEnablerName, parseEnablerFile, saveEnablerFile } from '../config.js';

// CodeQL round-2 triage (#120, js/remote-property-injection): the apps
// toggle route writes caller-named keys into .env.enabler. The writer has
// always skipped non-env-shaped keys; the route now also 400s on them via
// this shared validator instead of reporting a false success.
describe('enabler name validation', () => {
  it('accepts env-var-shaped names', () => {
    for (const ok of ['ENABLE_FOO', 'foo', '_PRIVATE', 'A1_b']) {
      assert.equal(isValidEnablerName(ok), true, ok);
    }
  });

  it('rejects names that cannot round-trip the enabler file', () => {
    for (const bad of ['', '1ABC', 'A B', 'A=B', 'A\nEVIL=true', 'a.b', 'A-B']) {
      assert.equal(isValidEnablerName(bad), false, JSON.stringify(bad));
    }
  });

  it('writer stores only valid keys and the file round-trips', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-enablers-'));
    saveEnablerFile(root, {
      ENABLE_OK: true,
      'BAD KEY': true,
      'INJECT\nEVIL': true,
    } as Record<string, boolean>);
    const raw = fs.readFileSync(path.join(root, '.env.enabler'), 'utf-8');
    assert.match(raw, /ENABLE_OK=true/);
    assert.ok(!raw.includes('BAD KEY'));
    assert.ok(!raw.includes('EVIL'));
    assert.deepEqual(parseEnablerFile(raw), { ENABLE_OK: true });
  });
});
