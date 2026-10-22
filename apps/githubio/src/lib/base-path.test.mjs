// Tests for src/lib/base-path.ts — the GitHub Pages asset-prefix contract
// shared with next.config.ts and the deploy workflow: GITHUBIO_BASE_PATH
// is '/<repo-name>' for the Pages deploy build and unset (root) locally.
// BASE_PATH is captured at module load, so each case sets the env var
// first and imports the module fresh (the query string defeats the ESM
// module cache between cases). Run with Node's built-in test runner —
// no test framework dependency for this one module.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('base-path', () => {
  it('defaults to no prefix when GITHUBIO_BASE_PATH is unset', async () => {
    delete process.env.GITHUBIO_BASE_PATH;
    const { BASE_PATH, asset } = await import('./base-path.ts?case=default');
    assert.equal(BASE_PATH, '');
    assert.equal(asset('/logo.png'), '/logo.png');
  });

  it('prefixes asset URLs with GITHUBIO_BASE_PATH when set', async () => {
    process.env.GITHUBIO_BASE_PATH = '/vigilant-octo-waffle';
    const { BASE_PATH, asset } = await import('./base-path.ts?case=pages');
    assert.equal(BASE_PATH, '/vigilant-octo-waffle');
    assert.equal(asset('/logo.png'), '/vigilant-octo-waffle/logo.png');
  });
});
