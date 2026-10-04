import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthzInvariantError } from '@vow/orchestrator';
import { routeError, apiError } from './route-error';
import { AuthzError } from './authz';

// Route errors log to stderr; keep test output clean.
beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

async function bodyOf(res: Response) {
  return (await res.json()) as {
    error: { code: string; message: string; reason?: string };
  };
}

describe('routeError classification', () => {
  it('AuthzError 403 → forbidden envelope with the decision reason', async () => {
    const res = routeError(new AuthzError('deny_missing_grant'), {
      route: 'GET /api/x',
    });
    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('forbidden');
    expect(body.error.reason).toBe('deny_missing_grant');
    expect(body.error.message).toMatch(/permission/i);
  });

  it('AuthzError 401 → unauthenticated', async () => {
    const res = routeError(new AuthzError('deny_unauthenticated'), {
      route: 'GET /api/x',
    });
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error.code).toBe('unauthenticated');
  });

  it('AuthzInvariantError → 409 conflict with authz_invariant reason', async () => {
    const res = routeError(
      new AuthzInvariantError('cannot remove the last owner'),
      { route: 'DELETE /api/x' }
    );
    expect(res.status).toBe(409);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('conflict');
    expect(body.error.reason).toBe('authz_invariant');
    expect(body.error.message).toMatch(/last owner/);
  });

  it('zod-shaped errors → 400 bad_request with the first issue', async () => {
    const zodLike = new Error('validation failed');
    zodLike.name = 'ZodError';
    (zodLike as { issues?: unknown }).issues = [
      { path: ['name'], message: 'Required' },
    ];
    const res = routeError(zodLike, { route: 'POST /api/x' });
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error.code).toBe('bad_request');
    expect(body.error.message).toBe('name: Required');
  });

  it('generic errors → 500 internal, honoring a status override', async () => {
    const res = routeError(new Error('kaput'), { route: 'GET /api/x' });
    expect(res.status).toBe(500);
    expect((await bodyOf(res)).error).toEqual({
      code: 'internal',
      message: 'kaput',
    });

    const res400 = routeError(new Error('bad input'), {
      route: 'POST /api/x',
      status: 400,
    });
    expect(res400.status).toBe(400);
    expect((await bodyOf(res400)).error.code).toBe('bad_request');
  });

  it('non-Error throwables → 500 with a generic message', async () => {
    const res = routeError('string failure', { route: 'GET /api/x' });
    expect(res.status).toBe(500);
    expect((await bodyOf(res)).error.message).toBe('Internal error');
  });
});

describe('apiError', () => {
  it('builds deliberate errors with code from status', async () => {
    const res = apiError(404, 'Unknown principal: p_x');
    expect(res.status).toBe(404);
    expect((await bodyOf(res)).error).toEqual({
      code: 'not_found',
      message: 'Unknown principal: p_x',
    });
  });

  it('carries an explicit reason', async () => {
    const res = apiError(409, 'Not enabled', { reason: 'authz_not_enabled' });
    expect((await bodyOf(res)).error.reason).toBe('authz_not_enabled');
  });
});
