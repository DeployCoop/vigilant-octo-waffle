import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, hashToken, loadAuthzStore, saveAuthzStore } from '../authz.js';

const cliPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../authz-cli.js'
);

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], root: string): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { env: { ...process.env, VOW_PROJECT_ROOT: root } },
      (error, stdout, stderr) => {
        resolve({
          // ExecFileException.code is string | number; CliResult.code is the
          // numeric exit code, so a non-numeric (spawn-error) code maps to 1.
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      }
    );
  });
}

function extractToken(output: string): string {
  const match = output.match(/vow_[A-Za-z0-9_-]+/);
  assert.ok(match, `expected a token in output:\n${output}`);
  return match[0];
}

describe('vow authz CLI', () => {
  let root: string;
  let ownerToken: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-cli-'));
  });

  it('init creates a store and prints the owner token once', async () => {
    const res = await runCli(['init', '--name', 'Josh'], root);
    assert.equal(res.code, 0, res.stderr);
    ownerToken = extractToken(res.stdout);
    const storeFile = path.join(root, '.vow', 'authz.yaml');
    assert.ok(fs.existsSync(storeFile));
    assert.equal(fs.statSync(storeFile).mode & 0o777, 0o600);
    // The plaintext token must never be persisted.
    assert.ok(!fs.readFileSync(storeFile, 'utf-8').includes(ownerToken));
  });

  it('init refuses to re-initialize a populated store', async () => {
    const res = await runCli(['init'], root);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /already initialized/);
  });

  it('add creates an operator and check enforces its bundle', async () => {
    const add = await runCli(['add', 'Teammate', '--role', 'operator'], root);
    assert.equal(add.code, 0, add.stderr);
    const operatorToken = extractToken(add.stdout);

    const allowed = await runCli(['check', operatorToken, 'apps:deploy'], root);
    assert.equal(allowed.code, 0, allowed.stdout);
    assert.match(allowed.stdout, /ALLOW apps:deploy .* allow_role_default/);

    const denied = await runCli(['check', operatorToken, 'k8s:exec'], root);
    assert.equal(denied.code, 1);
    assert.match(denied.stdout, /DENY k8s:exec .* deny_missing_grant/);
  });

  it('add supports scoped grants and OIDC principals', async () => {
    const scoped = await runCli(
      ['add', 'HarborBot', '--role', 'webhook', '--kind', 'service', '--grant', 'apps:deploy', '--scope-app', 'harbor'],
      root
    );
    assert.equal(scoped.code, 0, scoped.stderr);
    const botToken = extractToken(scoped.stdout);

    const inScope = await runCli(['check', botToken, 'apps:deploy', '--app', 'harbor'], root);
    assert.equal(inScope.code, 0, inScope.stdout);
    const outOfScope = await runCli(['check', botToken, 'apps:deploy', '--app', 'nextcloud'], root);
    assert.equal(outOfScope.code, 1);
    assert.match(outOfScope.stdout, /deny_scope/);

    const oidc = await runCli(['add', 'SSO User', '--role', 'viewer', '--oidc-subject', 'kc-42'], root);
    assert.equal(oidc.code, 0, oidc.stderr);
    assert.ok(!/vow_[A-Za-z0-9_-]{20,}/.test(oidc.stdout), 'OIDC principals get no token');
  });

  it('list shows principals without secrets', async () => {
    const res = await runCli(['list'], root);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /p_josh/);
    assert.match(res.stdout, /owner/);
    assert.ok(!res.stdout.includes('sha256:'));
    assert.ok(!res.stdout.includes(ownerToken));
  });

  it('rotate replaces the token and revoke removes the principal', async () => {
    const list = await runCli(['list'], root);
    const operatorId = list.stdout
      .split('\n')
      .find((line) => line.includes('operator'))
      ?.split(/\s+/)[0];
    assert.ok(operatorId);

    const rotated = await runCli(['rotate', operatorId], root);
    assert.equal(rotated.code, 0, rotated.stderr);
    const newToken = extractToken(rotated.stdout);

    const checkNew = await runCli(['check', newToken, 'apps:deploy'], root);
    assert.equal(checkNew.code, 0, checkNew.stdout);

    const revoked = await runCli(['revoke', operatorId], root);
    assert.equal(revoked.code, 0, revoked.stderr);
    const checkRevoked = await runCli(['check', newToken, 'apps:deploy'], root);
    assert.equal(checkRevoked.code, 1);
  });

  it('revoke protects the last owner', async () => {
    const res = await runCli(['revoke', 'p_josh'], root);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /at least one active owner/);
  });

  it('check with the owner token allows everything', async () => {
    const res = await runCli(['check', ownerToken, 'users:manage_permissions'], root);
    assert.equal(res.code, 0, res.stdout);
    assert.match(res.stdout, /allow_owner/);
  });

  it('init with --password sets explicit admin password', async () => {
    const customRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-pwd-'));
    const res = await runCli(['init', '--name', 'AdminUser', '--password', 'SecretPass123!'], customRoot);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /Initial owner password configured successfully/);

    const check = await runCli(['check', 'SecretPass123!', 'users:manage_permissions'], customRoot);
    assert.equal(check.code, 0, check.stdout);
    assert.match(check.stdout, /allow_owner/);

    const fail = await runCli(['check', 'WrongPass', 'users:manage_permissions'], customRoot);
    assert.equal(fail.code, 1);
  });

  it('init rejects a password below the floor and writes no store', async () => {
    const shortRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-short-'));
    const res = await runCli(['init', '--password', 'short'], shortRoot);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /at least 12 characters/);
    assert.equal(fs.existsSync(path.join(shortRoot, '.vow', 'authz.yaml')), false);
  });
});


describe('vow authz CLI — WS5 grant context', () => {
  let root: string;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-cli-ws5-'));
  });

  it('add --context lands in the store, list renders it, check honors the window', async () => {
    const init = await runCli(['init', '--name', 'Owner'], root);
    assert.equal(init.code, 0, init.stderr);

    const add = await runCli(
      [
        'add', 'Windowed',
        '--role', 'viewer',
        '--grant', 'apps:deploy',
        '--context', '{"notAfter":"2020-01-01T00:00:00.000Z","source":"loopback"}',
      ],
      root
    );
    assert.equal(add.code, 0, add.stderr);
    const token = extractToken(add.stdout);

    const list = await runCli(['list'], root);
    assert.match(list.stdout, /apps:deploy\[global\]\{src=loopback until=2020-01-01T00:00:00\.000Z\}/);

    // Default check context (now, non-loopback, token): expired window denies.
    const denied = await runCli(['check', token, 'apps:deploy'], root);
    assert.equal(denied.code, 1, denied.stdout);
    assert.match(denied.stdout, /DENY apps:deploy .*deny_context/);

    // Inside the window AND loopback: allows.
    const allowed = await runCli(
      ['check', token, 'apps:deploy', '--at', '2019-06-01T00:00:00.000Z', '--loopback'],
      root
    );
    assert.equal(allowed.code, 0, allowed.stdout);
    assert.match(allowed.stdout, /ALLOW apps:deploy/);

    // Inside the window but not loopback: still denied by source.
    const wrongSource = await runCli(
      ['check', token, 'apps:deploy', '--at', '2019-06-01T00:00:00.000Z'],
      root
    );
    assert.equal(wrongSource.code, 1);
    assert.match(wrongSource.stdout, /deny_context/);
  });

  it('rejects malformed --context values', async () => {
    const badJson = await runCli(
      ['add', 'Bad', '--grant', 'apps:deploy', '--context', '{nope'],
      root
    );
    assert.equal(badJson.code, 1);
    const badShape = await runCli(
      ['add', 'Bad2', '--grant', 'apps:deploy', '--context', '{"source":"moon"}'],
      root
    );
    assert.equal(badShape.code, 1);
    assert.match(badShape.stderr, /source must be/);
  });
});


describe('vow authz CLI — grant-context validation parity (single-sourced)', () => {
  let root: string;
  let ownerToken: string;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-cli-parity-'));
    const init = await runCli(['init', '--name', 'Owner'], root);
    assert.equal(init.code, 0, init.stderr);
    ownerToken = extractToken(init.stdout);
  });

  it('keeps the established --context error messages and accepts a valid context', async () => {
    const badMethod = await runCli(
      ['add', 'M', '--grant', 'apps:deploy', '--context', '{"authMethod":"smoke-signals"}'],
      root
    );
    assert.equal(badMethod.code, 1);
    assert.match(badMethod.stderr, /authMethod must be "session", "token", "oidc", or "any"/);

    const unknownField = await runCli(
      ['add', 'U', '--grant', 'apps:deploy', '--context', '{"planet":"earth"}'],
      root
    );
    assert.equal(unknownField.code, 1);
    assert.match(unknownField.stderr, /unknown field: planet/);

    const notObject = await runCli(
      ['add', 'N', '--grant', 'apps:deploy', '--context', '["loopback"]'],
      root
    );
    assert.equal(notObject.code, 1);
    assert.match(notObject.stderr, /must be a JSON object/);

    const badTime = await runCli(
      ['add', 'T', '--grant', 'apps:deploy', '--context', '{"notAfter":"next tuesday"}'],
      root
    );
    assert.equal(badTime.code, 1);
    assert.match(badTime.stderr, /notAfter must be an ISO timestamp/);

    const good = await runCli(
      [
        'add', 'G', '--grant', 'apps:deploy',
        '--context', '{"authMethod":"oidc","notBefore":"2020-01-01T00:00:00.000Z"}',
      ],
      root
    );
    assert.equal(good.code, 0, good.stderr);
  });

  it('check --auth-method still accepts only session|token|oidc', async () => {
    const wildcard = await runCli(
      ['check', ownerToken, 'apps:read', '--auth-method', 'any'],
      root
    );
    assert.equal(wildcard.code, 1);
    assert.match(wildcard.stderr, /--auth-method must be session, token, or oidc/);

    const bogus = await runCli(
      ['check', ownerToken, 'apps:read', '--auth-method', 'smoke-signals'],
      root
    );
    assert.equal(bogus.code, 1);
    assert.match(bogus.stderr, /--auth-method must be session, token, or oidc/);

    const session = await runCli(
      ['check', ownerToken, 'apps:read', '--auth-method', 'session'],
      root
    );
    assert.equal(session.code, 0, session.stdout);
    assert.match(session.stdout, /ALLOW apps:read/);
  });
});


describe('vow authz CLI — sessions', () => {
  let root: string;
  let ownerId: string;
  let liveIdHash: string;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-cli-sessions-'));
    const init = await runCli(['init', '--name', 'Boss'], root);
    assert.equal(init.code, 0, init.stderr);

    const list = await runCli(['list'], root);
    ownerId = list.stdout.split('\n').find((line) => line.includes('owner'))?.split(/\s+/)[0] ?? '';
    assert.ok(ownerId, `expected an owner row in list output:\n${list.stdout}`);

    // One live session via the store layer, plus one long-expired record
    // written directly (createSession would prune it on sight).
    const loaded = loadAuthzStore(root);
    if (loaded.status !== 'ready') throw new Error(`store not ready: ${loaded.status}`);
    const created = createSession(loaded.store, ownerId, new Date());
    liveIdHash = created.session.idHash;
    saveAuthzStore(root, {
      ...created.store,
      sessions: [
        ...(created.store.sessions ?? []),
        {
          idHash: hashToken('stale-session-id'),
          principalId: ownerId,
          createdAt: '2020-01-01T00:00:00.000Z',
          expiresAt: '2020-01-01T12:00:00.000Z',
        },
      ],
    });
  });

  it('sessions lists the live session (hash prefix only) and hides expired ones', async () => {
    const res = await runCli(['sessions'], root);
    assert.equal(res.code, 0, res.stderr);
    assert.ok(res.stdout.includes(ownerId), res.stdout);
    assert.ok(res.stdout.includes('Boss'), res.stdout);
    assert.ok(res.stdout.includes(liveIdHash.slice(0, 19)), res.stdout);
    // Only a prefix — the full stored hash must stay out of the output.
    assert.ok(!res.stdout.includes(liveIdHash), res.stdout);
    // The expired record is not listed.
    assert.ok(!res.stdout.includes('2020-01-01'), res.stdout);

    const filtered = await runCli(['sessions', '--principal', ownerId], root);
    assert.equal(filtered.code, 0, filtered.stderr);
    assert.ok(filtered.stdout.includes(liveIdHash.slice(0, 19)), filtered.stdout);
  });

  it('sessions on a fresh store prints an empty state', async () => {
    const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-cli-nosessions-'));
    const init = await runCli(['init', '--name', 'Solo'], freshRoot);
    assert.equal(init.code, 0, init.stderr);
    const res = await runCli(['sessions'], freshRoot);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /No active sessions\./);
  });

  it('revoke-sessions removes every stored session for the principal and reports the count', async () => {
    const res = await runCli(['revoke-sessions', ownerId], root);
    assert.equal(res.code, 0, res.stderr);
    // Both the live session and the expired record are removed.
    assert.match(res.stdout, /Revoked 2 sessions for /);

    const after = await runCli(['sessions'], root);
    assert.equal(after.code, 0, after.stderr);
    assert.match(after.stdout, /No active sessions\./);

    const loaded = loadAuthzStore(root);
    if (loaded.status !== 'ready') throw new Error(`store not ready: ${loaded.status}`);
    assert.equal(loaded.store.sessions, undefined);
  });

  it('revoke-sessions rejects an unknown principal', async () => {
    const res = await runCli(['revoke-sessions', 'p_nobody'], root);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /Unknown principal: p_nobody/);
  });
});
