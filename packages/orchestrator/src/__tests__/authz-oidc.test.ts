import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import {
  getOidcConfig,
  looksLikeJwt,
  verifyOidcToken,
  clearOidcCache,
  type OidcConfig,
} from '../index.js';

describe('authz OIDC config', () => {
  it('requires both issuer and client id', () => {
    assert.equal(getOidcConfig({}), null);
    assert.equal(getOidcConfig({ VOW_OIDC_ISSUER: 'https://idp.example' }), null);
    assert.equal(getOidcConfig({ VOW_OIDC_CLIENT_ID: 'vow' }), null);
    assert.deepEqual(
      getOidcConfig({ VOW_OIDC_ISSUER: 'https://idp.example/', VOW_OIDC_CLIENT_ID: 'vow' }),
      { issuer: 'https://idp.example', clientId: 'vow' }
    );
  });

  it('recognizes JWT structure', () => {
    assert.equal(looksLikeJwt('aaa.bbb.ccc'), true);
    assert.equal(looksLikeJwt('vow_token'), false);
    assert.equal(looksLikeJwt('a.b'), false);
    assert.equal(looksLikeJwt('a.b.c.d'), false);
    assert.equal(looksLikeJwt(''), false);
  });
});

describe('authz OIDC verification (local IdP)', () => {
  let server: http.Server;
  let issuer: string;
  let config: OidcConfig;
  let privateKey: CryptoKey;
  let publicJwk: Record<string, unknown>;

  async function signToken(claims: Record<string, unknown>, opts: { expiresIn?: string; issuer?: string; audience?: string } = {}): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(opts.issuer ?? issuer)
      .setAudience(opts.audience ?? 'vow-web')
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '5m')
      .sign(privateKey);
  }

  before(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey as CryptoKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' };

    server = http.createServer((req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      } else if (req.url === '/jwks') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [publicJwk] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    issuer = `http://127.0.0.1:${port}`;
    config = { issuer, clientId: 'vow-web' };
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    clearOidcCache();
  });

  it('verifies a valid ID token and returns sub + email', async () => {
    const token = await signToken({ sub: 'user-123', email: 'josh@example.com' });
    const identity = await verifyOidcToken(token, config);
    assert.deepEqual(identity, { subject: 'user-123', email: 'josh@example.com' });
  });

  it('returns an identity without email when the claim is absent', async () => {
    const token = await signToken({ sub: 'svc-9' });
    assert.deepEqual(await verifyOidcToken(token, config), { subject: 'svc-9', email: undefined });
  });

  it('rejects tokens from the wrong issuer or audience', async () => {
    const badIssuer = await signToken({ sub: 'x' }, { issuer: 'https://evil.example' });
    assert.equal(await verifyOidcToken(badIssuer, config), null);
    const badAudience = await signToken({ sub: 'x' }, { audience: 'someone-else' });
    assert.equal(await verifyOidcToken(badAudience, config), null);
  });

  it('rejects expired and tampered tokens', async () => {
    const expired = await signToken({ sub: 'x' }, { expiresIn: '-1m' });
    assert.equal(await verifyOidcToken(expired, config), null);

    const valid = await signToken({ sub: 'x' });
    const tampered = valid.slice(0, -4) + (valid.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    assert.equal(await verifyOidcToken(tampered, config), null);
  });

  it('rejects garbage and unreachable issuers without throwing', async () => {
    assert.equal(await verifyOidcToken('not-a-jwt', config), null);
    assert.equal(
      await verifyOidcToken('aaa.bbb.ccc', { issuer: 'http://127.0.0.1:9', clientId: 'vow-web' }),
      null
    );
  });
});
