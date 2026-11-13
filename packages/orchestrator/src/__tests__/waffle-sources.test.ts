import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  validateGitSourceUrl,
  validateGitBranch,
  validateLocalSourcePath,
  WaffleSourceManager,
} from '../waffle/sources.js';

describe('git source URL validation (bug hunt B12)', () => {
  it('accepts https://, ssh://, and user@host:path shapes', () => {
    validateGitSourceUrl('https://github.com/DeployCoop/vigilant-octo-waffle.git');
    validateGitSourceUrl('ssh://git@github.com/DeployCoop/vigilant-octo-waffle.git');
    validateGitSourceUrl('git@github.com:DeployCoop/vigilant-octo-waffle.git');
  });

  it('rejects option-like values', () => {
    assert.throws(() => validateGitSourceUrl('--upload-pack=touch /tmp/x'), /must not begin with '-'/);
    assert.throws(() => validateGitSourceUrl('-oProxyCommand=id'), /must not begin with '-'/);
  });

  it('rejects the ext:: transport', () => {
    assert.throws(() => validateGitSourceUrl('ext::sh -c id'), /ext::/);
  });

  it('rejects non-git schemes and whitespace/control characters', () => {
    assert.throws(() => validateGitSourceUrl('ftp://example.com/repo.git'), /not an allowed shape/);
    assert.throws(() => validateGitSourceUrl('git://example.com/repo.git'), /not an allowed shape/);
    assert.throws(
      () => validateGitSourceUrl('https://example.com/repo.git\n--upload-pack=id'),
      /whitespace/
    );
  });

  it('rejects dash-led branches, like assertSafeGitValue', () => {
    assert.throws(() => validateGitBranch('--upload-pack=id'), /must not begin with '-'/);
    validateGitBranch('main');
    validateGitBranch('feature/x');
  });
});

describe('local source path validation (bug hunt B12)', () => {
  it('requires absolute paths inside the project root', () => {
    validateLocalSourcePath('/proj', '/proj/charts');
    assert.throws(() => validateLocalSourcePath('/proj', 'relative/dir'), /absolute/);
    assert.throws(() => validateLocalSourcePath('/proj', '/etc'), /inside the project root/);
    assert.throws(() => validateLocalSourcePath('/proj', '/proj/../etc'), /inside the project root/);
  });
});

describe('WaffleSourceManager.addSource validation (bug hunt B12)', () => {
  let root = '';
  let manager: WaffleSourceManager;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-sources-'));
    manager = new WaffleSourceManager(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects ext:: and option-like git URLs before any clone is attempted', async () => {
    // Validation throws out of addSource (it is NOT swallowed into a
    // stored 'error' status by the clone try/catch).
    await assert.rejects(
      () => manager.addSource({ type: 'git', pathOrUrl: 'ext::sh -c id' }),
      /ext::/
    );
    await assert.rejects(
      () => manager.addSource({ type: 'git', pathOrUrl: '--upload-pack=id' }),
      /must not begin with '-'/
    );
    await assert.rejects(
      () => manager.addSource({ type: 'git', pathOrUrl: 'https://example.com/r.git', branch: '-b' }),
      /must not begin with '-'/
    );
  });

  it('rejects local directories outside the project root', async () => {
    await assert.rejects(
      () => manager.addSource({ type: 'local', pathOrUrl: '/etc' }),
      /inside the project root/
    );
    await assert.rejects(
      () => manager.addSource({ type: 'local', pathOrUrl: 'relative/dir' }),
      /absolute/
    );
  });
});
