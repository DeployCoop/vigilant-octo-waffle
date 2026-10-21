/**
 * Shared helpers for the orchestrator test suites.
 *
 * Two skip idioms exist in this package's tests; pick the right one:
 *
 * 1. `binaryAvailable()` (this module) — for suites that shell out to an
 *    external binary (helm, mkcert). Tests skip cleanly when the binary
 *    is absent so developer machines without the toolchain still get a
 *    green run; CI installs the binaries and asserts the skip count
 *    stays zero, so a skip in CI fails the build rather than passing.
 *
 * 2. `skipOrFail()` in parity.test.ts — for the bash<->TS parity cases,
 *    which need yq + envsubst. When VOW_PARITY_REQUIRED=1 (set in CI) a
 *    missing tool is a hard failure instead of a skip, because the
 *    parity guarantee is the point of that suite; locally it skips
 *    like idiom 1.
 */
import { spawnSync } from 'node:child_process';

/** Plan II §7.2: true when `cmd --version` runs without an error. */
export function binaryAvailable(cmd: string): boolean {
  try {
    return !spawnSync(cmd, ['--version'], { stdio: 'ignore' }).error;
  } catch {
    return false;
  }
}
