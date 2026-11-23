import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  togglePolicyRule: vi.fn(),
  evaluateManifest: vi.fn(),
  listAdmissionPolicies: vi.fn(),
  getAdmissionWebhookStatus: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    togglePolicyRule: hoisted.togglePolicyRule,
    evaluateManifest: hoisted.evaluateManifest,
    listAdmissionPolicies: hoisted.listAdmissionPolicies,
    getAdmissionWebhookStatus: hoisted.getAdmissionWebhookStatus,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import {
  generatePrincipalToken,
  hashToken,
  InvalidManifestError,
  ClusterUnavailableError,
  type Principal,
} from '@vow/orchestrator';
import { GET, POST } from './route';

/** Gate tests for /api/guard POST (bug hunt B3). */

const viewerToken = generatePrincipalToken();
const ownerToken = generatePrincipalToken();

const viewer: Principal = {
  id: 'p_view', name: 'Vic Viewer', kind: 'human', role: 'viewer',
  tokenHash: hashToken(viewerToken),
};
const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};

function readyStore() {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [viewer, owner] } };
}

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/guard', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getReq(token?: string) {
  return new Request('http://localhost:3000/api/guard', {
    method: 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-guard-'));
  hoisted.togglePolicyRule.mockReset();
  hoisted.evaluateManifest.mockReset();
  hoisted.listAdmissionPolicies.mockReset();
  hoisted.getAdmissionWebhookStatus.mockReset();
  hoisted.togglePolicyRule.mockReturnValue({ rule: 'x', enabled: false });
  hoisted.evaluateManifest.mockReturnValue({ violations: [] });
  hoisted.listAdmissionPolicies.mockResolvedValue([]);
  hoisted.getAdmissionWebhookStatus.mockResolvedValue({
    installed: false,
    validating: [],
    mutating: [],
  });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/guard gates (B3)', () => {
  it('denies toggle to a viewer (security:read is not enough)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'toggle', ruleId: 'x' }, viewerToken));
    expect(res.status).toBe(403);
    expect(hoisted.togglePolicyRule).not.toHaveBeenCalled();
  });

  it('allows toggle to the owner (security:manage via owner)', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'toggle', ruleId: 'x' }, ownerToken));
    expect(res.status).toBe(200);
    expect(hoisted.togglePolicyRule).toHaveBeenCalled();
  });

  it('keeps the pure evaluate path on security:read (viewer passes)', async () => {
    readyStore();
    const res = await POST(postReq({ yaml: 'apiVersion: v1' }, viewerToken));
    expect(res.status).toBe(200);
    expect(hoisted.evaluateManifest).toHaveBeenCalled();
  });
});

describe('POST /api/guard validation (C7) + invalid YAML (C3)', () => {
  it('maps InvalidManifestError to 400, not 500', async () => {
    readyStore();
    hoisted.evaluateManifest.mockImplementation(() => {
      throw new InvalidManifestError();
    });
    const res = await POST(postReq({ yaml: 'key: [unclosed' }, viewerToken));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/Invalid YAML/);
  });

  it('rejects a non-boolean enabled with 400', async () => {
    readyStore();
    const res = await POST(
      postReq({ action: 'toggle', ruleId: 'x', enabled: 1 }, ownerToken)
    );
    expect(res.status).toBe(400);
    expect(hoisted.togglePolicyRule).not.toHaveBeenCalled();
  });
});

describe('GET /api/guard (Phase 1 wiring)', () => {
  it('returns policies and live webhook status to a viewer', async () => {
    readyStore();
    const policies = [{ id: 'r1', enabled: true }];
    hoisted.listAdmissionPolicies.mockResolvedValue(policies);
    hoisted.getAdmissionWebhookStatus.mockResolvedValue({
      installed: true,
      validating: ['kyverno-validating'],
      mutating: [],
    });
    const res = await GET(getReq(viewerToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies).toEqual(policies);
    expect(body.webhookStatus.installed).toBe(true);
    expect(body.webhookStatus.validating).toEqual(['kyverno-validating']);
  });

  it('maps ClusterUnavailableError to 503 with code cluster_unavailable', async () => {
    readyStore();
    hoisted.listAdmissionPolicies.mockRejectedValue(new ClusterUnavailableError());
    const res = await GET(getReq(viewerToken));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('cluster_unavailable');
  });
});

describe('POST /api/guard toggle not-found + no-cluster (Phase 1 wiring)', () => {
  it('returns 404 for an unknown rule id', async () => {
    readyStore();
    hoisted.togglePolicyRule.mockResolvedValue(null);
    const res = await POST(
      postReq({ action: 'toggle', ruleId: 'no-such-rule', enabled: true }, ownerToken)
    );
    expect(res.status).toBe(404);
  });

  it('maps ClusterUnavailableError to 503 with code cluster_unavailable', async () => {
    readyStore();
    hoisted.togglePolicyRule.mockRejectedValue(new ClusterUnavailableError());
    const res = await POST(
      postReq({ action: 'toggle', ruleId: 'x', enabled: true }, ownerToken)
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('cluster_unavailable');
  });
});
