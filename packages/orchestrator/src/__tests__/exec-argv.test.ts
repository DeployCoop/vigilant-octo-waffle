/**
 * Regression tests for the 2026-10-14 bug sweep (shell-injection class):
 * command execution must be argv-based. Values that used to be
 * interpolated into /bin/sh -c strings (with JSON.stringify misused as
 * quoting) must reach the binary literally — `$(...)`, backticks, `;`
 * and friends are data, never syntax.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  execFileAsync,
  pipeExecs,
  assertK8sLabel,
  assertK8sObjectName,
  assertImageRef,
  ExecArgvError,
} from '../exec-argv.js';

describe('execFileAsync (argv execution)', () => {
  it('passes shell metacharacters literally', async () => {
    const payload = '$(echo PWNED) `echo PWNED` ; echo PWNED | cat #';
    const { stdout } = await execFileAsync('echo', [payload]);
    assert.equal(stdout.trim(), payload);
  });

  it('rejects on non-zero exit and carries stderr', async () => {
    await assert.rejects(
      execFileAsync('sh', ['-c', 'echo out; echo err 1>&2; exit 3']),
      (err: ExecArgvError) => {
        assert.equal(err.code, 3);
        assert.match(err.stderr, /err/);
        return true;
      }
    );
  });

  it('feeds stdin input', async () => {
    const { stdout } = await execFileAsync('cat', [], { input: 'hello-stdin' });
    assert.equal(stdout, 'hello-stdin');
  });

  it('enforces timeoutMs', async () => {
    await assert.rejects(
      execFileAsync('sleep', ['5'], { timeoutMs: 150 }),
      /timed out/
    );
  });
});

describe('pipeExecs', () => {
  it('streams producer stdout into consumer stdin', async () => {
    const { stdout } = await pipeExecs(
      { file: 'printf', args: ['a\\nb\\nc\\n'] },
      { file: 'grep', args: ['b'] }
    );
    assert.equal(stdout, 'b\n');
  });

  it('rejects when the producer fails', async () => {
    await assert.rejects(
      pipeExecs({ file: 'false', args: [] }, { file: 'cat', args: [] })
    );
  });
});

describe('error labels redact credentials (bug-hunt Batch A5 follow-up)', () => {
  it('redacts --token values from spawn-failure messages', async () => {
    await assert.rejects(
      execFileAsync('definitely-not-a-real-binary-xyz', ['--token', 's3cret-value', 'other']),
      (err: ExecArgvError) => {
        assert.match(err.message, /\[redacted\]/);
        assert.doesNotMatch(err.message, /s3cret-value/);
        return true;
      }
    );
  });

  it('redacts URL-embedded credentials from spawn-failure messages', async () => {
    await assert.rejects(
      execFileAsync('definitely-not-a-real-binary-xyz', [
        'clone',
        'https://user:s3cret@host.example/repo.git',
      ]),
      (err: ExecArgvError) => {
        assert.doesNotMatch(err.message, /s3cret/);
        assert.match(err.message, /user:\[redacted\]@host\.example/);
        return true;
      }
    );
  });
});

describe('input validators', () => {
  it('accepts legal names and rejects flag-shaped / illegal values', () => {
    assert.equal(assertK8sLabel('my-pod-1', 'pod name'), 'my-pod-1');
    assert.equal(assertK8sObjectName('app.example-1', 'application name'), 'app.example-1');
    for (const bad of ['-n', '--help', 'a b', 'a;b', 'a$(id)', '', 'A_upper', 'a/b']) {
      assert.throws(() => assertK8sLabel(bad, 'pod name'), /Invalid pod name/);
      assert.throws(() => assertK8sObjectName(bad, 'application name'), /Invalid application name/);
    }
    assert.equal(assertImageRef('localhost:5001/img:tag'), 'localhost:5001/img:tag');
    assert.throws(() => assertImageRef('-t evil'), /Invalid image reference/);
    assert.throws(() => assertImageRef('img; rm -rf /'), /Invalid image reference/);
  });
});
