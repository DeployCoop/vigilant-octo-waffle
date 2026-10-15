/**
 * Shell-free subprocess execution (bug-sweep fix, 2026-10-14).
 *
 * The codebase historically ran commands as interpolated strings through
 * `promisify(exec)` — i.e. `/bin/sh -c` — with `JSON.stringify` misused as
 * shell quoting. JSON double quotes do not stop `$(…)`, backticks or `$VAR`
 * expansion, and arguments without spaces went in completely raw, so any
 * caller-controlled value (a namespace, release name, image tag, webhook
 * app name) could break out into arbitrary shell execution.
 *
 * Everything in this module executes an argv array with `shell: false`:
 * arguments are passed to the binary verbatim and can never be re-parsed
 * by a shell. Use it instead of string commands wherever values are not
 * compile-time constants.
 */
import { spawn, type ChildProcess } from 'node:child_process';

export interface ExecArgvOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Written to the child's stdin, which is then closed. */
  input?: string | Buffer;
  /** Max bytes captured per stream before the child is killed (default 10 MiB). */
  maxBuffer?: number;
  /** Kill the child after this many ms and reject. */
  timeoutMs?: number;
  /**
   * Buffer stdout and enforce maxBuffer on it (default true). Set false
   * for a streaming producer in a pipe, whose stdout is not captured.
   */
  captureStdout?: boolean;
}

export interface ExecArgvResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export class ExecArgvError extends Error {
  stdout: string;
  stderr: string;
  code: number | null;
  constructor(message: string, result: ExecArgvResult) {
    super(message);
    this.name = 'ExecArgvError';
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.code = result.code;
  }
}

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

/** Children currently running through this module (for cooperative abort). */
const activeChildren = new Set<ChildProcess>();

/** Kills every child started through this module. Used by pipeline abort. */
export function killActiveChildren(signal: NodeJS.Signals = 'SIGKILL'): void {
  for (const child of activeChildren) {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

function collect(
  child: ChildProcess,
  cmdLabel: string,
  opts: ExecArgvOptions
): Promise<ExecArgvResult> {
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  return new Promise((resolve, reject) => {
    activeChildren.add(child);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill('SIGKILL');
            } catch {
              // already gone
            }
          }, opts.timeoutMs)
        : null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      activeChildren.delete(child);
      fn();
    };

    child.stdout?.on('data', (d: Buffer) => {
      if (opts.captureStdout === false) return;
      stdoutBytes += d.length;
      if (stdoutBytes > maxBuffer) {
        finish(() =>
          reject(
            new ExecArgvError(`Command exceeded maxBuffer (${maxBuffer} bytes): ${cmdLabel}`, {
              stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
              stderr: Buffer.concat(stderrChunks).toString('utf-8'),
              code: null,
            })
          )
        );
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
        return;
      }
      stdoutChunks.push(d);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderrBytes += d.length;
      if (stderrBytes <= maxBuffer) stderrChunks.push(d);
    });
    // A child that exits early must not crash us with EPIPE on its stdin.
    child.stdin?.on('error', () => {});
    child.on('error', (err) => {
      finish(() =>
        reject(
          new ExecArgvError(`Failed to spawn ${cmdLabel}: ${err.message}`, {
            stdout: '',
            stderr: '',
            code: null,
          })
        )
      );
    });
    child.on('close', (code) => {
      const result: ExecArgvResult = {
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        code,
      };
      finish(() => {
        if (timedOut) {
          reject(
            new ExecArgvError(`Command timed out after ${opts.timeoutMs}ms: ${cmdLabel}`, result)
          );
        } else if (code === 0) {
          resolve(result);
        } else {
          reject(
            new ExecArgvError(
              `Command failed: ${cmdLabel}${result.stderr ? `\n${result.stderr.trim()}` : ''}`,
              result
            )
          );
        }
      });
    });

    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

/**
 * Runs `file` with an argv array, no shell. Resolves on exit code 0 and
 * rejects with ExecArgvError (carrying stdout/stderr/code) otherwise —
 * mirroring `promisify(exec)` semantics so call sites can migrate directly.
 */
export function execFileAsync(
  file: string,
  args: string[],
  opts: ExecArgvOptions = {}
): Promise<ExecArgvResult> {
  const child = spawn(file, args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return collect(child, `${file} ${args.join(' ')}`, opts);
}

/**
 * Streams `producer`'s stdout into `consumer`'s stdin (`a | b`) without a
 * shell and without buffering the stream in memory. Resolves when the
 * consumer exits 0; rejects if either side fails.
 */
export function pipeExecs(
  producer: { file: string; args: string[] },
  consumer: { file: string; args: string[] },
  opts: ExecArgvOptions = {}
): Promise<ExecArgvResult> {
  const label = `${producer.file} ${producer.args.join(' ')} | ${consumer.file} ${consumer.args.join(' ')}`;
  const a = spawn(producer.file, producer.args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const b = spawn(consumer.file, consumer.args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  activeChildren.add(a);
  activeChildren.add(b);
  a.stdout?.pipe(b.stdin!);
  // If the consumer dies early the producer's writes raise EPIPE on its
  // stdout socket via the pipe; swallow stream errors — exit codes decide.
  a.stdout?.on('error', () => {});
  b.stdin?.on('error', () => {});

  const aDone = collect(a, label, { ...opts, captureStdout: false }).catch((e) => e);
  const bDone = collect(b, label, opts);
  return Promise.all([aDone, bDone]).then(([aRes, bRes]) => {
    activeChildren.delete(a);
    activeChildren.delete(b);
    if (aRes instanceof Error) throw aRes;
    return bRes;
  });
}

/** True when `name` resolves to an executable on PATH (no shell needed). */
export async function commandExists(name: string): Promise<boolean> {
  const { accessSync, constants } = await import('node:fs');
  const path = await import('node:path');
  if (name.includes('/')) {
    try {
      accessSync(name, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, name), constants.X_OK);
      return true;
    } catch {
      // keep searching
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Input validators for values that end up as Kubernetes object references.
// argv execution already prevents shell breakout; these additionally reject
// values that are not legal object names, so a bad value fails fast with a
// clear error instead of being reinterpreted by kubectl/helm flag parsing
// (e.g. a leading `-` turning a "name" into flags).
// ---------------------------------------------------------------------------

/** RFC 1123 label (namespace names, pod names are the DNS-subdomain superset below). */
export function isK8sLabel(value: string): boolean {
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value) && value.length <= 63;
}

/** RFC 1123 subdomain (application names, release names, cluster names). */
export function isK8sObjectName(value: string): boolean {
  return /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(value) && value.length <= 253;
}

export function assertK8sObjectName(value: string, what: string): string {
  if (!isK8sObjectName(value)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(value)} (expected an RFC 1123 name)`);
  }
  return value;
}

export function assertK8sLabel(value: string, what: string): string {
  if (!isK8sLabel(value)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(value)} (expected an RFC 1123 label)`);
  }
  return value;
}

/** Docker image reference (`name[:tag][@digest]`, optionally registry-prefixed). */
export function isImageRef(value: string): boolean {
  return /^[a-z0-9][a-z0-9._/:@-]*$/i.test(value) && !value.startsWith('-') && value.length <= 255;
}

export function assertImageRef(value: string, what = 'image reference'): string {
  if (!isImageRef(value)) {
    throw new Error(`Invalid ${what}: ${JSON.stringify(value)}`);
  }
  return value;
}
