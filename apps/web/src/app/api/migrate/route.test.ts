import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  executeZeroDowntimeMigration: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    executeZeroDowntimeMigration: hoisted.executeZeroDowntimeMigration,
  };
});

import { generatePrincipalToken, hashToken, type Principal } from '@vow/orchestrator';
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
  hoisted.executeZeroDowntimeMigration.mockReset();
  hoisted.executeZeroDowntimeMigration.mockResolvedValue({ success: true });
});

describe('POST /api/migrate gates (B6)', () => {
  it('denies execute to a data:query-only principal', async () => {
    readyStore();
    const res = await POST(postReq(
      { action: 'execute', version: 'v1', sql: 'CREATE TABLE t (id INT);' }, querierToken
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

  it('requires sql for execute', async () => {
    readyStore();
    const res = await POST(postReq({ action: 'execute', version: 'v1' }, ownerToken));
    expect(res.status).toBe(400);
    expect(hoisted.executeZeroDowntimeMigration).not.toHaveBeenCalled();
  });

  it('refuses execute when the supplied DDL has BLOCKER findings', async () => {
    readyStore();
    const res = await POST(postReq(
      { action: 'execute', version: 'v1', sql: 'CREATE INDEX idx ON t (c);' }, ownerToken
    ));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/BLOCKER/);
    expect(hoisted.executeZeroDowntimeMigration).not.toHaveBeenCalled();
  });

  it('executes for the owner with clean DDL', async () => {
    readyStore();
    const res = await POST(postReq(
      { action: 'execute', version: 'v1', sql: 'CREATE TABLE t (id INT);' }, ownerToken
    ));
    expect(res.status).toBe(200);
    expect(hoisted.executeZeroDowntimeMigration).toHaveBeenCalledWith('v1');
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
      message: 'Migration version v9 not found.',
    });
    const res = await POST(
      postReq({ action: 'execute', version: 'v9', sql: 'CREATE TABLE t (id INT);' }, ownerToken)
    );
    expect(res.status).toBe(404);
  });
});
