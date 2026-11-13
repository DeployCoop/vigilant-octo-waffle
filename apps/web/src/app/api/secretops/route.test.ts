import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET, POST } from './route';

/**
 * Behavior tests for /api/secretops (bug hunt B1/B2/B4).
 * The real generateSealedSecretManifest is used: it must throw (the
 * route turns that into a 501), never a manifest.
 */

const viewerToken = generatePrincipalToken();
const operatorToken = generatePrincipalToken();
const adminToken = generatePrincipalToken();
const ownerToken = generatePrincipalToken();

const viewer: Principal = {
  id: 'p_view', name: 'Vic Viewer', kind: 'human', role: 'viewer',
  tokenHash: hashToken(viewerToken),
};
const operator: Principal = {
  id: 'p_op', name: 'Oscar Operator', kind: 'human', role: 'operator',
  tokenHash: hashToken(operatorToken),
};
// Neither viewer nor operator holds secrets:read — admin is the
// lowest role that does, so GET coverage uses admin.
const admin: Principal = {
  id: 'p_admin', name: 'Ada Admin', kind: 'human', role: 'admin',
  tokenHash: hashToken(adminToken),
};
const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};

function readyStore() {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer, operator, admin, owner] } };
}

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/secretops', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-secretops-'));
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/secretops — sealed-secret refusal (B1/B2)', () => {
  it('returns 501 with the refusal message and no manifest, even with keyValues', async () => {
    const res = await POST(postReq({
      action: 'generate_sealed',
      secretName: 'app-api-token',
      namespace: 'default',
      keyValues: { api_token: 'some-real-secret-value' },
    }));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.message).toMatch(/not implemented/i);
    expect(body).not.toHaveProperty('manifest');
    // No plaintext-derived content anywhere in the response.
    expect(JSON.stringify(body)).not.toContain('some-real-secret');
    expect(JSON.stringify(body)).not.toContain(Buffer.from('some-real-secret-value').toString('base64').slice(0, 10));
  });

  it('rejects missing keyValues with 400 (no changeme123 default)', async () => {
    const missing = await POST(postReq({
      action: 'generate_sealed', secretName: 'x', namespace: 'default',
    }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toMatch(/keyValues/);

    const empty = await POST(postReq({
      action: 'generate_sealed', secretName: 'x', namespace: 'default', keyValues: {},
    }));
    expect(empty.status).toBe(400);
  });
});

describe('POST /api/secretops — manage gate (B4)', () => {
  it('denies viewer and operator (no secrets:manage) for rotate', async () => {
    readyStore();
    const asViewer = await POST(postReq(
      { action: 'rotate', secretName: 'x', namespace: 'default' }, viewerToken
    ));
    expect(asViewer.status).toBe(403);
    const asOperator = await POST(postReq(
      { action: 'rotate', secretName: 'x', namespace: 'default' }, operatorToken
    ));
    expect(asOperator.status).toBe(403);
  });

  it('allows the owner to rotate', async () => {
    readyStore();
    const res = await POST(postReq(
      { action: 'rotate', secretName: 'x', namespace: 'default' }, ownerToken
    ));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});

describe('GET /api/secretops — read gate unchanged', () => {
  it('serves the audit report to an admin (secrets:read) and denies a viewer', async () => {
    readyStore();
    const ok = await GET(new Request('http://localhost:3000/api/secretops', {
      headers: { authorization: `Bearer ${adminToken}` },
    }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).leaksDetected).toBeDefined();
    const denied = await GET(new Request('http://localhost:3000/api/secretops', {
      headers: { authorization: `Bearer ${viewerToken}` },
    }));
    expect(denied.status).toBe(403);
  });
});

describe('POST /api/secretops validation (C7)', () => {
  it('rejects a non-label namespace on rotate with 400', async () => {
    readyStore();
    const res = await POST(
      postReq({ action: 'rotate', secretName: 'x', namespace: 'Bad_Ns' }, ownerToken)
    );
    expect(res.status).toBe(400);
  });
});
