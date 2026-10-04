/**
 * The API error envelope (improvements plan WS4).
 *
 * Every API error response has one shape:
 *
 *   { "error": { "code": "string_code", "message": "human readable",
 *                "reason": "optional machine reason" } }
 *
 * This module is pure (no server imports) so client components can
 * use `apiErrorMessage` to read error bodies safely.
 */

export interface ApiError {
  code: string;
  message: string;
  reason?: string;
}

export interface ApiErrorBody {
  error: ApiError;
}

export function errorBody(
  code: string,
  message: string,
  reason?: string
): ApiErrorBody {
  return { error: reason ? { code, message, reason } : { code, message } };
}

/** Stable code vocabulary for plain HTTP statuses. */
export function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 500:
      return 'internal';
    default:
      return status >= 500 ? 'internal' : 'error';
  }
}

/**
 * Extract a human-readable message from a fetch JSON body of either
 * era: the envelope (`{ error: { message } }`), the legacy shape
 * (`{ error: "string" }`), or a success payload carrying an `error`
 * string field. Falls back when nothing usable is present.
 */
export function apiErrorMessage(data: unknown, fallback = 'Request failed'): string {
  if (data !== null && typeof data === 'object') {
    const err = (data as { error?: unknown }).error;
    if (typeof err === 'string' && err) return err;
    if (err !== null && typeof err === 'object') {
      const message = (err as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
    }
  }
  return fallback;
}
