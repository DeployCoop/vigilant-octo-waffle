/**
 * Plan III §5.7: the waffle debug() channel (waffle/shared.ts) is the
 * observability hook for failure-masking catch sites. It must be silent
 * unless VOW_DEBUG is set, and write to stderr only when it is — never
 * to run output.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debug } from '../waffle/shared.js';

test('debug() is silent without VOW_DEBUG and emits to stderr with it', () => {
  const originalWrite = process.stderr.write.bind(process.stderr);
  const originalEnv = process.env.VOW_DEBUG;
  const captured: string[] = [];
  process.stderr.write = ((chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    delete process.env.VOW_DEBUG;
    debug('must not appear');
    assert.deepEqual(captured, []);

    process.env.VOW_DEBUG = '1';
    debug('must appear');
    assert.equal(captured.length, 1);
    assert.match(captured[0], /\[waffle:debug\] must appear\n$/);
  } finally {
    process.stderr.write = originalWrite;
    if (originalEnv === undefined) delete process.env.VOW_DEBUG;
    else process.env.VOW_DEBUG = originalEnv;
  }
});
