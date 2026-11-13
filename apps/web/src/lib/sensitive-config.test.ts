import { describe, it, expect } from 'vitest';
import { isSensitiveConfigKey, SENSITIVE_CONFIG_KEYS, SENSITIVE_CONFIG_PREFIXES } from './sensitive-config';

/** Unit coverage for the B8 sensitive-key set. */
describe('isSensitiveConfigKey', () => {
  it('flags the exact sensitive keys', () => {
    for (const key of SENSITIVE_CONFIG_KEYS) {
      expect(isSensitiveConfigKey(key)).toBe(true);
    }
    expect(SENSITIVE_CONFIG_KEYS).toContain('VOW_API_TOKEN');
    expect(SENSITIVE_CONFIG_KEYS).toContain('VOW_WEBHOOK_TOKEN');
    expect(SENSITIVE_CONFIG_KEYS).toContain('VOW_LDAP_BIND_DN');
    expect(SENSITIVE_CONFIG_KEYS).toContain('VOW_LDAP_BIND_PASSWORD');
    expect(SENSITIVE_CONFIG_KEYS).toContain('VOW_LDAP_ALLOW_BREAK_GLASS');
  });

  it('flags every key under a sensitive prefix', () => {
    for (const prefix of SENSITIVE_CONFIG_PREFIXES) {
      expect(isSensitiveConfigKey(`${prefix}ANYTHING`)).toBe(true);
    }
    expect(isSensitiveConfigKey('VOW_OIDC_ISSUER')).toBe(true);
    expect(isSensitiveConfigKey('VOW_OIDC_CLIENT_SECRET')).toBe(true);
    expect(isSensitiveConfigKey('VOW_AUTHZ_FILE')).toBe(true);
    expect(isSensitiveConfigKey('VOW_SESSION_SECRET')).toBe(true);
    expect(isSensitiveConfigKey('VOW_LDAP_URL')).toBe(true);
  });

  it('passes ordinary config keys', () => {
    for (const key of [
      'VOW_TASK_STORE', 'VOW_AUDIT_MAX_BYTES', 'VOW_PROJECT_ROOT',
      'THIS_DOMAIN', 'VOW_NOT_SENSITIVE_BUT_UNRELATED',
    ]) {
      expect(isSensitiveConfigKey(key)).toBe(false);
    }
  });
});
