import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  generateClusterSecrets: vi.fn(),
  saveClusterSecrets: vi.fn(),
  loadProjectConfig: vi.fn(),
  listClusterSecrets: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    generateClusterSecrets: hoisted.generateClusterSecrets,
    saveClusterSecrets: hoisted.saveClusterSecrets,
    loadProjectConfig: hoisted.loadProjectConfig,
    listClusterSecrets: hoisted.listClusterSecrets,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
import { GET, POST } from './route';

/** Gate tests for /api/secrets (bug hunt B4). */

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

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-secrets-'));
  for (const fn of [
    hoisted.generateClusterSecrets, hoisted.saveClusterSecrets,
    hoisted.loadProjectConfig, hoisted.listClusterSecrets,
  ]) fn.mockReset();
  hoisted.loadProjectConfig.mockReturnValue({
    raw: {}, cluster: { namespace: 'default', domain: 'example.local' },
  });
  hoisted.listClusterSecrets.mockReturnValue([]);
  hoisted.generateClusterSecrets.mockReturnValue({ items: { a: 'b' } });
  hoisted.saveClusterSecrets.mockReturnValue(['/tmp/x.yaml']);
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('POST /api/secrets gates (B4)', () => {
  it('denies operator (secrets:read is not enough)', async () => {
    readyStore();
    const res = await POST(new Request('http://localhost:3000/api/secrets', {
      method: 'POST',
      headers: { authorization: `Bearer ${operatorToken}` },
    }));
    expect(res.status).toBe(403);
    expect(hoisted.generateClusterSecrets).not.toHaveBeenCalled();
  });

  it('allows the owner (secrets:manage)', async () => {
    readyStore();
    const res = await POST(new Request('http://localhost:3000/api/secrets', {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
    }));
    expect(res.status).toBe(200);
    expect(hoisted.generateClusterSecrets).toHaveBeenCalled();
  });
});

describe('GET /api/secrets stays secrets:read', () => {
  it('serves an admin (secrets:read) and denies a viewer', async () => {
    readyStore();
    const ok = await GET(new Request('http://localhost:3000/api/secrets', {
      headers: { authorization: `Bearer ${adminToken}` },
    }));
    expect(ok.status).toBe(200);
    const denied = await GET(new Request('http://localhost:3000/api/secrets', {
      headers: { authorization: `Bearer ${viewerToken}` },
    }));
    expect(denied.status).toBe(403);
  });
});
