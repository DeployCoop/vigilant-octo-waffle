import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const WEBHOOK_TOKEN = 'middleware-webhook-token';
const API_TOKEN = 'middleware-api-token';

function request(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    method: 'POST',
    headers,
  });
}

function isPassThrough(res: Response): boolean {
  // NextResponse.next() marks the response with this header.
  return res.headers.get('x-middleware-next') === '1';
}

describe('middleware — webhook deferral', () => {
  const originalWebhook = process.env.VOW_WEBHOOK_TOKEN;
  const originalApi = process.env.VOW_API_TOKEN;

  beforeEach(() => {
    delete process.env.VOW_WEBHOOK_TOKEN;
    delete process.env.VOW_API_TOKEN;
  });

  afterEach(() => {
    if (originalWebhook === undefined) delete process.env.VOW_WEBHOOK_TOKEN;
    else process.env.VOW_WEBHOOK_TOKEN = originalWebhook;
    if (originalApi === undefined) delete process.env.VOW_API_TOKEN;
    else process.env.VOW_API_TOKEN = originalApi;
  });

  it('defers the webhook route to its own token when VOW_WEBHOOK_TOKEN is set', async () => {
    process.env.VOW_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
    process.env.VOW_API_TOKEN = API_TOKEN;
    // Even a cross-origin caller with no shared token passes the middleware;
    // the route itself enforces the webhook credential.
    const res = middleware(
      request('/api/argo/webhook', { origin: 'https://elsewhere.example', host: 'localhost:3000' })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it('still applies the shared token gate to the webhook when VOW_WEBHOOK_TOKEN is unset', async () => {
    process.env.VOW_API_TOKEN = API_TOKEN;
    const res = middleware(request('/api/argo/webhook'));
    expect(res.status).toBe(401);
  });

  it('still applies the shared token gate to other routes when the webhook token is set', async () => {
    process.env.VOW_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
    process.env.VOW_API_TOKEN = API_TOKEN;
    const res = middleware(request('/api/apps'));
    expect(res.status).toBe(401);
  });

  it('still blocks cross-origin mutations on other routes', async () => {
    const res = middleware(
      request('/api/apps', { origin: 'https://elsewhere.example', host: 'localhost:3000' })
    );
    expect(res.status).toBe(403);
  });
});
