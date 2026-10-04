/**
 * Server-side error responses (improvements plan WS4).
 *
 * `routeError(err, { route })` is the single way route handlers turn
 * a thrown error into the API envelope: it classifies known error
 * types, logs the failure structurally, and returns the envelope
 * NextResponse. `apiError(status, message, ...)` covers deliberate
 * (non-thrown) errors such as validation failures and not-founds.
 */
import { NextResponse } from 'next/server';
import { AuthzInvariantError } from '@vow/orchestrator';
import { AuthzError } from './authz';
import { codeForStatus, errorBody } from './envelope';
import { log } from './log';

/**
 * Structural ZodError check: routes validate with the orchestrator's
 * zod copy, so `instanceof` against a local import would both need a
 * second zod dependency and silently miss across package copies.
 */
interface ZodLikeError {
  issues: { path: (string | number)[]; message: string }[];
}
function isZodError(err: unknown): err is ZodLikeError {
  return (
    err instanceof Error &&
    err.name === 'ZodError' &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

export interface RouteErrorOptions {
  /** Route identifier for logs, e.g. "GET /api/apps". */
  route: string;
  /**
   * Status for GENERIC errors (default 500). Classified errors
   * (AuthzError, AuthzInvariantError, ZodError) always use their
   * canonical status; this covers call sites whose local convention
   * treats unknown failures as e.g. 400.
   */
  status?: number;
  /** Force the envelope code. */
  code?: string;
  principalId?: string;
}

export function routeError(err: unknown, opts: RouteErrorOptions): NextResponse {
  let status = opts.status ?? 500;
  let code = opts.code;
  let reason: string | undefined;
  let message: string;

  if (err instanceof AuthzError) {
    status = err.status;
    code = opts.code ?? (err.status === 401 ? 'unauthenticated' : 'forbidden');
    reason = err.reason;
    message = err.message;
  } else if (err instanceof AuthzInvariantError) {
    status = 409;
    code = opts.code ?? 'conflict';
    reason = 'authz_invariant';
    message = err.message;
  } else if (isZodError(err)) {
    status = 400;
    code = opts.code ?? 'bad_request';
    const first = err.issues[0];
    message = first
      ? `${first.path.join('.') || 'body'}: ${first.message}`
      : 'Invalid request body';
  } else {
    message = err instanceof Error ? err.message : 'Internal error';
    code = opts.code ?? codeForStatus(status);
  }

  log(status >= 500 ? 'error' : 'warn', 'route error', {
    route: opts.route,
    principalId: opts.principalId,
    code,
    status,
    err,
  });
  return NextResponse.json(errorBody(code, message, reason), { status });
}

export interface ApiErrorOptions {
  route?: string;
  code?: string;
  reason?: string;
  principalId?: string;
}

/** Build a deliberate error response in the envelope shape. */
export function apiError(
  status: number,
  message: string,
  opts: ApiErrorOptions = {}
): NextResponse {
  const code = opts.code ?? codeForStatus(status);
  if (opts.route) {
    log(status >= 500 ? 'error' : 'warn', 'route error', {
      route: opts.route,
      principalId: opts.principalId,
      code,
      status,
      err: new Error(message),
    });
  }
  return NextResponse.json(errorBody(code, message, opts.reason), { status });
}
