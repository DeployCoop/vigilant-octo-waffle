import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  getMigrationStatus: vi.fn(),
  executeZeroDowntimeMigration: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    getMigrationStatus: hoisted.getMigrationStatus,
    executeZeroDowntimeMigration: hoisted.executeZeroDowntimeMigration,
  };
});

import {
  generatePrincipalToken,
  hashToken,
  ClusterUnavailableError,
  type Principal,
} from '@vow/orchestrator';
import { GET, POST } from './route';

/** Gate + lint-gate tests for /api/migrate (bug hunt B6). */

const querierToken = generatePrincipalToken();
const ownerToken = generatePrincipalToken();

// A principal holding data:query but NOT data:migrate.
const querier: Principal = {
  id: 'p_q', name: 'Quinn Querier', kind: 'human', role: 'viewer',
  tokenHash: hashToken(querierToken),
  grants: [{ permission: 'data:query' }],
};
const owner: Principal = {
  id: 'p_owner', name: 'Olivia Owner', kind: 'human', role: 'owner',
  tokenHash: hashToken(ownerToken),
};

function readyStore() {
  hoisted.load = { status: 'ready', store: { version: 1, principals: [querier, owner] } };
}

function postReq(body: unknown, token?: string) {
  return new Request('http://localhost:3000/api/migrate', {
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
  hoisted.getMigrationStatus.mockReset();
  hoisted.getMigrationStatus.mockResolvedValue([]);
  hoisted.executeZeroDowntimeMigration.mockReset();
  hoisted.executeZeroDowntimeMigration.mockResolvedValue({ success: true });
});

describe('POST /api/migrate gates (B6)', () => {
  it('denies execute to a data:query-only principal', async () => {
    readyStore();
    const res = await POST(postReq(
      { action: 'execute', version: 'v1' }, querierToken
    ));
    expect(res.status).toBe(403);
    expect(hoisted.executeZeroDowntimeMigration).not.toHaveBeenCalled();
  });

  it('keeps lint on data:query (querier passes)', async () => {
    readyStore();
    const res = await POST(postReq(
      { action: 'lint', sql: 'CREATE TABLE t (id INT);' }, querierToken
    ));
    expect(res.status).toBe(200);
    expect((await res.json()).lintResult.clean).toBe(true);
  });

  it('requires version for execute', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'execute' }, ownerToken));
    expect(res.status).toBe(400);
    expect(hoisted.executeZeroDowntimeMigration).not.toHaveBeenCalled();
  });

  it('executes for the owner with version only — no caller SQL travels (the file is the DDL)', async () => {
    readyStore();
    const res = await POST(postReq(
      { action: 'execute', version: 'v1' }, ownerToken
    ));
    expect(res.status).toBe(200);
    expect(hoisted.executeZeroDowntimeMigration).toHaveBeenCalledWith('v1');
  });

  it('maps a blocked execution to 400 (lint BLOCKER lives inside execute now)', async () => {
    readyStore();
    hoisted.executeZeroDowntimeMigration.mockResolvedValue({
      success: false,
      executedVersion: 'v1',
      errorKind: 'blocked',
      message: 'Migration blocked: 1 BLOCKER lint finding(s): CREATE INDEX takes an exclusive lock.',
    });
    const res = await POST(postReq({ action: 'execute', version: 'v1' }, ownerToken));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/BLOCKER/);
  });

  it('maps a failed execution to 500', async () => {
    readyStore();
    hoisted.executeZeroDowntimeMigration.mockResolvedValue({
      success: false,
      executedVersion: 'v1',
      errorKind: 'failed',
      message: 'Migration v1 failed after 12ms: psql: error: relation "t" does not exist',
    });
    const res = await POST(postReq({ action: 'execute', version: 'v1' }, ownerToken));
    expect(res.status).toBe(500);
  });

  it('keeps GET on data:query', async () => {
    readyStore();
    const res = await GET(new Request('http://localhost:3000/api/migrate', {
      headers: { authorization: `Bearer ${querierToken}` },
    }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/migrate validation + unknown version (C7/C8)', () => {
  it('trips BLOCKER on a multi-line CREATE INDEX via the real linter', async () => {
    readyStore();
    const res = await POST(
      postReq({ action: 'lint', sql: 'CREATE\nINDEX idx ON t (c);' }, querierToken)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lintResult.clean).toBe(false);
    expect(body.lintResult.findings.some((f: { severity: string }) => f.severity === 'BLOCKER')).toBe(true);
  });

  it('does not flag CREATE INDEX inside a comment', async () => {
    readyStore();
    const res = await POST(
      postReq({ action: 'lint', sql: '-- CREATE INDEX idx ON t (c);\nSELECT 1;' }, querierToken)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).lintResult.clean).toBe(true);
  });

  it('returns 404 when executing an unknown version', async () => {
    readyStore();
    hoisted.executeZeroDowntimeMigration.mockResolvedValue({
      success: false,
      executedVersion: 'v9',
      errorKind: 'not_found',
      message: 'Migration version v9 not found.',
    });
    const res = await POST(
      postReq({ action: 'execute', version: 'v9' }, ownerToken)
    );
    expect(res.status).toBe(404);
  });

  it('returns 503 with cluster_unavailable when the cluster is down', async () => {
    readyStore();
    hoisted.getMigrationStatus.mockRejectedValue(
      new ClusterUnavailableError('Kubernetes cluster is unavailable')
    );
    const res = await GET(new Request('http://localhost:3000/api/migrate', {
      headers: { authorization: `Bearer ${querierToken}` },
    }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('cluster_unavailable');
  });
});
