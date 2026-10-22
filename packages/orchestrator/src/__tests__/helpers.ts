/**
 * Shared helpers for the orchestrator test suites.
 *
 * Two skip-or-fail idioms exist in this package's tests; pick the right
 * one. Both skip cleanly on developer machines without the toolchain,
 * and both turn into a hard failure when their REQUIRED env var is set
 * (CI sets both), so the coverage cannot silently void in CI:
 *
 * 1. `skipOrFailBinary()` (this module) — for tests that shell out to
 *    an external binary (helm, mkcert), gated on VOW_BINARY_REQUIRED.
 *    Call it first in the test body: `if (skipOrFailBinary(t, 'helm'))
 *    return;`. (This replaces the Plan II §7.2 re-run assertion in CI,
 *    which re-ran the binary-gated files and grep'd the captured
 *    output for `skipped 0` — the capture intermittently came back
 *    empty and failed healthy builds.)
 *
 * 2. `skipOrFail()` in parity.test.ts — for the bash<->TS parity cases,
 *    which need yq + envsubst, gated on VOW_PARITY_REQUIRED. Same
 *    shape; the parity guarantee is the point of that suite.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/** Plan II §7.2: true when `cmd --version` runs without an error. */
export function binaryAvailable(cmd: string): boolean {
  try {
    return !spawnSync(cmd, ['--version'], { stdio: 'ignore' }).error;
  } catch {
    return false;
  }
}

/** True when CI demands the binary-gated tests actually run. */
export const binaryRequired = process.env.VOW_BINARY_REQUIRED === '1';

/**
 * Idiom 1 (see header): binary gate for a single test. Returns false
 * when `cmd` is available and the test should proceed. When the binary
 * is absent, fails the test outright under VOW_BINARY_REQUIRED=1 (CI);
 * otherwise marks the test skipped via `t` and returns true so the
 * caller returns early.
 */
export function skipOrFailBinary(
  t: { skip: (msg: string) => void },
  cmd: string
): boolean {
  if (binaryAvailable(cmd)) return false;
  if (binaryRequired) {
    assert.fail(`VOW_BINARY_REQUIRED=1 but ${cmd} is not on PATH`);
  }
  t.skip(`${cmd} not on PATH (CI installs it)`);
  return true;
}
