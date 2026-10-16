import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgyArgs } from '../antigravity/engine.js';
import { agySkipPermissionsEnabled } from '../antigravity/providers.js';

// Plan II §4.1: --dangerously-skip-permissions is opt-in only
// (VOW_AGY_SKIP_PERMISSIONS=1), never the default.
describe('agy permission-skipping opt-in', () => {
  it('helper accepts only the exact opt-in value', () => {
    assert.equal(agySkipPermissionsEnabled({}), false);
    assert.equal(agySkipPermissionsEnabled({ VOW_AGY_SKIP_PERMISSIONS: '0' }), false);
    assert.equal(agySkipPermissionsEnabled({ VOW_AGY_SKIP_PERMISSIONS: 'true' }), false);
    assert.equal(agySkipPermissionsEnabled({ VOW_AGY_SKIP_PERMISSIONS: '1' }), true);
  });

  it('omits the flag by default and preserves argument order', () => {
    const args = buildAgyArgs(
      'json',
      'high',
      { conversationId: 'c1', model: 'm1', prompt: 'p' },
      {}
    );
    assert.deepEqual(args, [
      '--effort', 'high',
      '--output-format', 'json',
      '--conversation', 'c1',
      '--model', 'm1',
      '-p', 'p',
    ]);
  });

  it('prepends the flag when opted in (streaming variant)', () => {
    const args = buildAgyArgs(
      'stream-json',
      'low',
      { prompt: 'p' },
      { VOW_AGY_SKIP_PERMISSIONS: '1' }
    );
    assert.deepEqual(args, [
      '--dangerously-skip-permissions',
      '--effort', 'low',
      '--output-format', 'stream-json',
      '-p', 'p',
    ]);
  });
});
