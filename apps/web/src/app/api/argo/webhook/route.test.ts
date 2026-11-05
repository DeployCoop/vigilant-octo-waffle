import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  root: '',
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
}));

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

// Keep the real authorizeWebhookRequest from the orchestrator (that
// integration is exactly what this suite protects) but stub the actual
// sync side effect.
vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    accelerateArgoSync: vi.fn(async () => ({
      success: true,
      message: 'sync dispatched',
      method: 'mock',
    })),
  };
});

import { POST } from './route';
import {
  accelerateArgoSync,
  generatePrincipalToken,
  hashToken,
  type Principal,
} from '@vow/orchestrator';

const TOKEN = 'route-test-webhook-token';
const mockedSync = vi.mocked(accelerateArgoSync);

function webhookRequest(headers: Record<string, string> = {}, body: unknown = { appName: 'harbor' }) {
  return new Request('http://localhost:3000/api/argo/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/argo/webhook service token', () => {
  const originalEnv = process.env.VOW_WEBHOOK_TOKEN;

  beforeEach(() => {
    mockedSync.mockClear();
    delete process.env.VOW_WEBHOOK_TOKEN;
    hoisted.load = { status: 'disabled' };
    // Audit entries from webhook auth decisions land in a throwaway root.
    hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-webhook-route-'));
  });

  afterEach(() => {
    fs.rmSync(hoisted.root, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.VOW_WEBHOOK_TOKEN;
    else process.env.VOW_WEBHOOK_TOKEN = originalEnv;
  });

  it('keeps legacy behavior when VOW_WEBHOOK_TOKEN is not set', async () => {
    const res = await POST(webhookRequest());
    expect(res.status).toBe(200);
    expect(mockedSync).toHaveBeenCalledTimes(1);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('passes appName and domain through to the sync accelerator', async () => {
    await POST(webhookRequest({}, { appName: 'nextcloud', domain: 'example.com' }));
    expect(mockedSync).toHaveBeenCalledWith('nextcloud', 'example.com');
  });

  it('rejects requests without a credential once the token is configured', async () => {
    process.env.VOW_WEBHOOK_TOKEN = TOKEN;
    const res = await POST(webhookRequest());
    expect(res.status).toBe(401);
    expect(mockedSync).not.toHaveBeenCalled();
    const data = await res.json();
    expect(data.error.message).toMatch(/webhook token/i);
  });

  it('rejects requests with a wrong token', async () => {
    process.env.VOW_WEBHOOK_TOKEN = TOKEN;
    const res = await POST(webhookRequest({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it('accepts the token as an Authorization Bearer credential', async () => {
    process.env.VOW_WEBHOOK_TOKEN = TOKEN;
    const res = await POST(webhookRequest({ authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it('accepts the token via the x-vow-webhook-token header', async () => {
    process.env.VOW_WEBHOOK_TOKEN = TOKEN;
    const res = await POST(webhookRequest({ 'x-vow-webhook-token': TOKEN }));
    expect(res.status).toBe(200);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });
});

// BUG FIX (bug hunt B7): when an authz store is active and no webhook
// token is configured, unauthenticated calls must be denied — the
// legacy open path only applies while no store is active.
describe('POST /api/argo/webhook with an active authz store', () => {
  const argoToken = generatePrincipalToken();
  const argo: Principal = {
    id: 'p_argo', name: 'Argo Automation', kind: 'service', role: 'viewer',
    tokenHash: hashToken(argoToken),
    grants: [{ permission: 'webhook:argo' }],
  };

  beforeEach(() => {
    mockedSync.mockClear();
    delete process.env.VOW_WEBHOOK_TOKEN;
    hoisted.load = { status: 'ready', store: { version: 1, principals: [argo] } };
    hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-webhook-route-'));
  });

  afterEach(() => {
    fs.rmSync(hoisted.root, { recursive: true, force: true });
  });

  it('denies an unauthenticated call when no token is configured', async () => {
    const res = await POST(webhookRequest());
    expect(res.status).toBe(401);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it('allows a principal holding webhook:argo', async () => {
    const res = await POST(webhookRequest({ authorization: `Bearer ${argoToken}` }));
    expect(res.status).toBe(200);
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });
});
