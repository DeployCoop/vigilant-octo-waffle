import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  discoverLocalHostnames,
  getDevCertificatePaths,
  hasDevCertificate,
  ensureDevCertificate,
} from '../tls.js';

describe('TLS & mkcert helper', () => {
  it('discovers local hostnames including localhost and IPs', () => {
    const names = discoverLocalHostnames();
    assert.ok(names.includes('localhost'));
    assert.ok(names.includes('127.0.0.1'));
    assert.ok(names.includes('monitaur.net'));
  });

  it('reports hasDevCertificate false on empty directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-tls-test-'));
    assert.equal(hasDevCertificate(tmp), false);
  });

  it('generates dev certificate via mkcert', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-tls-test-'));
    const info = await ensureDevCertificate(tmp, { hostnames: ['test.local'] });

    assert.ok(fs.existsSync(info.certPath));
    assert.ok(fs.existsSync(info.keyPath));
    assert.ok(hasDevCertificate(tmp));

    const certContent = fs.readFileSync(info.certPath, 'utf-8');
    assert.match(certContent, /BEGIN CERTIFICATE/);

    const keyContent = fs.readFileSync(info.keyPath, 'utf-8');
    assert.match(keyContent, /BEGIN (EC )?PRIVATE KEY/);

    // Key permissions should be 0600
    const stat = fs.statSync(info.keyPath);
    assert.equal(stat.mode & 0o777, 0o600);
  });
});
