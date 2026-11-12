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
  scrubUrlCredentials,
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

describe('scrubUrlCredentials (CodeQL js/polynomial-redos fix)', () => {
  it('redacts URL credentials and leaves everything else alone', () => {
    const cases: Array<[string, string]> = [
      ['https://user:s3cret@host.example/repo.git', 'https://user:[redacted]@host.example/repo.git'],
      ['https://user@host.example/repo.git', 'https://user@host.example/repo.git'],
      ['https://host:8080/path', 'https://host:8080/path'],
      ['https://user:pa/ss@host', 'https://user:[redacted]@host'],
      ['https://user:pa ss@host', 'https://user:pa ss@host'],
      ['https://us@er:pass@host', 'https://us@er:[redacted]@host'],
      ['https://user:@host', 'https://user:@host'],
      ['https://:pass@host', 'https://:pass@host'],
      ['git@github.com:user/repo.git', 'git@github.com:user/repo.git'],
      ['ssh://git@github.com:22/repo', 'ssh://git@github.com:22/repo'],
      ['https://a:b@h1 and https://c:d@h2', 'https://a:[redacted]@h1 and https://c:[redacted]@h2'],
      ['plain-arg', 'plain-arg'],
      ['', ''],
    ];
    for (const [input, expected] of cases) {
      assert.equal(scrubUrlCredentials(input), expected, JSON.stringify(input));
    }
  });

  it('handles the CodeQL pathological input in linear time', () => {
    // The old regex took 5.3s on this exact shape at 20k repetitions
    // (400ms at 5k); the indexOf scan must stay well under a second.
    const hostile = '://!:' + '://!:!'.repeat(20000);
    const t0 = Date.now();
    const out = scrubUrlCredentials(hostile);
    const elapsed = Date.now() - t0;
    assert.equal(out, hostile);
    assert.ok(elapsed < 1000, `took ${elapsed}ms`);
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
