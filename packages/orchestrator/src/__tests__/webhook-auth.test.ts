import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeWebhookRequest,
  extractWebhookToken,
  getConfiguredWebhookToken,
  webhookTokensEqual,
  WEBHOOK_TOKEN_ENV,
} from '../index.js';

const TOKEN = 'test-webhook-token-0123456789';

function headersWith(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('webhook service token', () => {
  describe('getConfiguredWebhookToken', () => {
    it('returns the configured token', () => {
      assert.equal(getConfiguredWebhookToken({ [WEBHOOK_TOKEN_ENV]: TOKEN }), TOKEN);
    });

    it('treats unset, empty, and blank values as unconfigured', () => {
      assert.equal(getConfiguredWebhookToken({}), undefined);
      assert.equal(getConfiguredWebhookToken({ [WEBHOOK_TOKEN_ENV]: '' }), undefined);
      assert.equal(getConfiguredWebhookToken({ [WEBHOOK_TOKEN_ENV]: '   ' }), undefined);
    });
  });

  describe('extractWebhookToken', () => {
    it('reads the x-vow-webhook-token header', () => {
      assert.equal(
        extractWebhookToken(headersWith({ 'x-vow-webhook-token': TOKEN })),
        TOKEN
      );
    });

    it('reads an Authorization Bearer token', () => {
      assert.equal(
        extractWebhookToken(headersWith({ authorization: `Bearer ${TOKEN}` })),
        TOKEN
      );
    });

    it('prefers the dedicated header over Bearer', () => {
      const headers = headersWith({
        'x-vow-webhook-token': TOKEN,
        authorization: 'Bearer something-else',
      });
      assert.equal(extractWebhookToken(headers), TOKEN);
    });

    it('returns null when no credential is presented', () => {
      assert.equal(extractWebhookToken(headersWith({})), null);
      assert.equal(extractWebhookToken(headersWith({ authorization: 'Basic abc' })), null);
      assert.equal(extractWebhookToken(headersWith({ authorization: 'Bearer ' })), null);
    });
  });

  describe('webhookTokensEqual', () => {
    it('matches identical tokens and rejects different ones', () => {
      assert.equal(webhookTokensEqual(TOKEN, TOKEN), true);
      assert.equal(webhookTokensEqual('wrong-token', TOKEN), false);
      assert.equal(webhookTokensEqual(TOKEN + 'x', TOKEN), false);
      assert.equal(webhookTokensEqual('', TOKEN), false);
    });
  });

  describe('authorizeWebhookRequest', () => {
    const env = { [WEBHOOK_TOKEN_ENV]: TOKEN };

    it('allows any request when no token is configured (legacy behavior)', () => {
      const result = authorizeWebhookRequest(headersWith({}), {});
      assert.deepEqual(result, { authorized: true, mode: 'unconfigured' });
    });

    it('allows a request with the correct Bearer token', () => {
      const result = authorizeWebhookRequest(
        headersWith({ authorization: `Bearer ${TOKEN}` }),
        env
      );
      assert.deepEqual(result, { authorized: true, mode: 'token' });
    });

    it('allows a request with the correct dedicated header', () => {
      const result = authorizeWebhookRequest(
        headersWith({ 'x-vow-webhook-token': TOKEN }),
        env
      );
      assert.deepEqual(result, { authorized: true, mode: 'token' });
    });

    it('rejects a request with no credential once a token is configured', () => {
      const result = authorizeWebhookRequest(headersWith({}), env);
      assert.equal(result.authorized, false);
      if (!result.authorized) {
        assert.equal(result.status, 401);
        assert.match(result.error, /webhook token/i);
      }
    });

    it('rejects a request with a wrong token', () => {
      const result = authorizeWebhookRequest(
        headersWith({ authorization: 'Bearer wrong-token' }),
        env
      );
      assert.equal(result.authorized, false);
    });

    it('does not leak which credential form was used on failure', () => {
      const viaBearer = authorizeWebhookRequest(
        headersWith({ authorization: 'Bearer nope' }),
        env
      );
      const viaHeader = authorizeWebhookRequest(
        headersWith({ 'x-vow-webhook-token': 'nope' }),
        env
      );
      assert.deepEqual(viaBearer, viaHeader);
    });
  });
});
