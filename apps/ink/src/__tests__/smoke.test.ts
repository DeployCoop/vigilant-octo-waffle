/**
 * WS7 — end-to-end smoke for the built `vow` binary: help surface and
 * the raw authz passthrough (the ink-side half; the orchestrator's
 * authz-cli tests cover runAuthzCommand itself).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(here, '..', 'cli.js');

function runVow(args: string[], cwd: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [cliPath, ...args], {
      cwd,
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('vow binary smoke', () => {
  it('--help exits 0 and lists the command surface', { timeout: 120_000 }, () => {
    const { code, out } = runVow(['--help'], os.tmpdir());
    assert.equal(code, 0);
    assert.match(out, /Usage: vow /);
    for (const name of ['up', 'doctor', 'waffle', 'k3s', 'app']) {
      assert.match(out, new RegExp(`\\b${name}\\b`));
    }
  });

  it('unknown commands exit non-zero with a parser error', { timeout: 120_000 }, () => {
    const { code, out } = runVow(['bogus-command'], os.tmpdir());
    assert.notEqual(code, 0);
    assert.match(out, /unknown command/i);
  });

  it('authz passthrough: init + list run against the cwd project', { timeout: 120_000 }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-ink-authz-'));
    try {
      const init = runVow(['authz', 'init', '--name', 'Ink Smoke'], dir);
      assert.equal(init.code, 0, init.out);
      assert.match(init.out, /Created authorization store/);
      assert.ok(fs.existsSync(path.join(dir, '.vow', 'authz.yaml')));

      const list = runVow(['authz', 'list'], dir);
      assert.equal(list.code, 0, list.out);
      assert.match(list.out, /Ink Smoke/);
      assert.match(list.out, /owner/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
