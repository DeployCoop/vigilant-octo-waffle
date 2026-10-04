/**
 * Secret redaction for API responses (plan §4.2 / Q5).
 *
 * Principals without the `secrets:read` permission receive config-bearing
 * responses with secret values replaced by `[redacted]`. A value counts
 * as secret when its key name matches the pattern below and the value is
 * a non-empty string (numbers/booleans under similar names are config
 * flags, not secrets). The walk is deep and does not mutate its input.
 */

export const REDACTED_VALUE = '[redacted]';

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|api[-_]?key|private[-_]?key|access[-_]?key|client[-_]?secret|credential|encryption[-_]?key)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        typeof entry === 'string' && entry !== '' && isSecretKey(key)
          ? REDACTED_VALUE
          : redactSecrets(entry);
    }
    return out as T;
  }
  return value;
}
