/**
 * Regression tests for the 2026-10-15 CodeQL triage sweep.
 *
 * Each test pins the fix for one verified REAL alert (or a residual found
 * alongside one): .env shell inertness (#50), scrypt password storage (#53),
 * antigravity custom-endpoint SSRF confinement (#20/#21), manifest-detection
 * ReDoS (#5–#16), and IP-literal validation for ssh peer targets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnvFile, saveEnvFile } from '../config.js';
import { hashPassword, hashToken, verifyTokenHash } from '../authz.js';
import {
  isAllowedCustomEndpoint,
  stripTrailingSlashes,
} from '../antigravity/providers.js';
import { detectManifestPatch } from '../antigravity/engine.js';
import { isIpAddressLiteral } from '../exec-argv.js';

test('.env values with shell metacharacters are inert when sourced and round-trip exactly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-env-'));
  const marker = path.join(dir, 'pwned');
  const payloads: Record<string, string> = {
    VOW_A: `$(touch ${marker})`,
    VOW_B: '`touch ' + marker + '`',
    VOW_C: 'quote " and back\\slash and $HOME and \\$(nope)',
    VOW_D: 'plain value 123',
  };
  saveEnvFile(dir, payloads);

  // Round-trip through the TS parser must be exact.
  const parsed = parseEnvFile(fs.readFileSync(path.join(dir, '.env'), 'utf-8'));
  for (const [k, v] of Object.entries(payloads)) {
    assert.equal(parsed[k], v, `parseEnvFile round-trip for ${k}`);
  }

  // Sourcing in bash must produce the literal values and execute nothing.
  for (const k of Object.keys(payloads)) {
    const out = execFileSync(
      'bash',
      ['-c', 'set -a; source "$1"; printf %s "${!2}"', 'bash', path.join(dir, '.env'), k],
      { encoding: 'utf-8' }
    );
    assert.equal(out, payloads[k], `bash-sourced value for ${k}`);
  }
  assert.equal(fs.existsSync(marker), false, 'payload executed during source');
});

test('user-chosen passwords are stored with scrypt and verify; legacy sha256 tokens still verify', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.ok(stored.startsWith('scrypt:'), `expected scrypt scheme, got ${stored.slice(0, 12)}`);
  assert.equal(verifyTokenHash('correct horse battery staple', stored), true);
  assert.equal(verifyTokenHash('wrong password', stored), false);
  assert.equal(verifyTokenHash('correct horse battery staple', 'scrypt:zz:yy'), false);
  assert.equal(verifyTokenHash('correct horse battery staple', 'scrypt:onlyone'), false);

  const token = 'vow_' + 'a'.repeat(43);
  const tokenHash = hashToken(token);
  assert.ok(tokenHash.startsWith('sha256:'));
  assert.equal(verifyTokenHash(token, tokenHash), true);
  assert.equal(verifyTokenHash('vow_wrong', tokenHash), false);
});

test('custom model endpoints are confined to loopback/LAN targets', () => {
  const allowed = [
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://127.5.0.9:8000',
    'http://10.0.0.5:11434',
    'http://172.16.3.4:8000',
    'http://172.31.255.255:8000',
    'http://192.168.1.50:11434',
    'http://[::1]:11434',
    'http://[fd00::7]:8000',
    'http://ollama:11434',
    'http://myhost.local:11434',
    'https://models.lan:8443',
    'http://ollama.default.svc:11434',
  ];
  const denied = [
    'http://169.254.169.254/latest/meta-data/',
    'http://[fe80::1]:11434',
    'http://8.8.8.8:11434',
    'http://172.32.0.1:8000',
    'http://192.169.0.1:8000',
    'https://example.com:11434',
    'http://models.example.org:8000',
    'file:///etc/passwd',
    'gopher://127.0.0.1:70/',
    'not a url',
    'http://256.1.1.1:11434',
  ];
  for (const u of allowed) assert.equal(isAllowedCustomEndpoint(u), true, u);
  for (const u of denied) assert.equal(isAllowedCustomEndpoint(u), false, u);
});

test('stripTrailingSlashes is exact', () => {
  assert.equal(stripTrailingSlashes('http://localhost:11434'), 'http://localhost:11434');
  assert.equal(stripTrailingSlashes('http://localhost:11434/'), 'http://localhost:11434');
  assert.equal(stripTrailingSlashes('http://localhost:11434////'), 'http://localhost:11434');
  assert.equal(stripTrailingSlashes('///'), '');
  assert.equal(stripTrailingSlashes(''), '');
  assert.equal(stripTrailingSlashes('/a/b/'), '/a/b');
});

test('detectManifestPatch stays correct and linear on adversarial whitespace', () => {
  const good =
    'Here you go:\n\n```yaml\napiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: demo\n  namespace: argocd\nspec:\n  project: default\n```\n';
  const found = detectManifestPatch(good);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'Application');
  assert.equal(found[0].name, 'demo');
  assert.equal(found[0].namespace, 'argocd');
  assert.equal(found[0].isArgoApp, true);

  // Unterminated fence + whitespace runs: the pre-fix regexes backtracked
  // quadratically here (measured ~1.4s per 20KB across the regex family).
  const adversarial = '```yaml' + '\n '.repeat(50_000) + 'kind:';
  const started = Date.now();
  const none = detectManifestPatch(adversarial);
  const elapsed = Date.now() - started;
  assert.ok(Array.isArray(none));
  assert.ok(elapsed < 5000, `detectManifestPatch took ${elapsed}ms on adversarial input`);
});

test('isIpAddressLiteral accepts real IPs and rejects option-smuggling values', () => {
  for (const ok of ['192.168.1.50', '10.0.0.1', '255.255.255.0', '::1', 'fd00::7', '2001:db8::1']) {
    assert.equal(isIpAddressLiteral(ok), true, ok);
  }
  for (const bad of ['-oProxyCommand=id', '256.1.1.1', 'example.com', '', '1.2.3', '1.2.3.4.5', '-o']) {
    assert.equal(isIpAddressLiteral(bad), false, bad);
  }
});
