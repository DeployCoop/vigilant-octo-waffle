import { describe, it, expect } from 'vitest';
import { REDACTED_VALUE, isSecretKey, redactSecrets } from './redaction';

describe('isSecretKey', () => {
  it('matches secret-bearing key names', () => {
    for (const key of [
      'DB_PASSWORD',
      'postgres_password',
      'API_TOKEN',
      'VOW_API_TOKEN',
      'apiKey',
      'API_KEY',
      'PRIVATE_KEY',
      'client_secret',
      'AWS_ACCESS_KEY_ID',
      'encryptionKey',
      'credentials',
    ]) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });

  it('does not match ordinary config keys', () => {
    for (const key of ['THIS_DOMAIN', 'APP_NAME', 'ENABLED', 'NAMESPACE', 'monkey', 'keyboard']) {
      expect(isSecretKey(key), key).toBe(false);
    }
  });
});

describe('redactSecrets', () => {
  it('masks secret string values and leaves the rest untouched', () => {
    const input = {
      config: {
        THIS_DOMAIN: 'waffle.local',
        DB_PASSWORD: 'hunter2',
        API_TOKEN: 'tok_123',
        EMPTY_SECRET: '',
        RETRY_COUNT: 3,
      },
    };
    const out = redactSecrets(input);
    expect(out.config.THIS_DOMAIN).toBe('waffle.local');
    expect(out.config.DB_PASSWORD).toBe(REDACTED_VALUE);
    expect(out.config.API_TOKEN).toBe(REDACTED_VALUE);
    // Empty strings and non-strings under secret-ish names are flags, not secrets.
    expect(out.config.EMPTY_SECRET).toBe('');
    expect(out.config.RETRY_COUNT).toBe(3);
  });

  it('walks nested objects and arrays without mutating the input', () => {
    const input = {
      profiles: [{ name: 'prod', nested: { GITHUB_TOKEN: 'ghp_x' } }],
    };
    const out = redactSecrets(input);
    expect(out.profiles[0].nested.GITHUB_TOKEN).toBe(REDACTED_VALUE);
    expect(out.profiles[0].name).toBe('prod');
    expect(input.profiles[0].nested.GITHUB_TOKEN).toBe('ghp_x');
  });

  it('passes primitives through', () => {
    expect(redactSecrets('plain')).toBe('plain');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
  });
});
