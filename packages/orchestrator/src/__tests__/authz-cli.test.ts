import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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
          code: error ? ((error as any).code ?? 1) : 0,
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
});
