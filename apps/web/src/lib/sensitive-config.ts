/**
 * Security-sensitive `.env` keys (bug hunt B8).
 *
 * A config:update holder (admin) must not be able to persist these via
 * POST /api/config: VOW_API_TOKEN becomes a bootstrap-owner credential
 * on restart, VOW_WEBHOOK_TOKEN is the webhook credential, VOW_OIDC_*
 * redirects OIDC trust, VOW_AUTHZ* toggles authorization itself,
 * VOW_LDAP_* controls the identity backend (including the bind
 * credential and the break-glass flag), and VOW_SESSION* is reserved
 * for session configuration. Writing any of them additionally requires
 * users:manage_permissions (owner-only).
 */
export const SENSITIVE_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'VOW_API_TOKEN',
  'VOW_WEBHOOK_TOKEN',
  'VOW_LDAP_BIND_DN',
  'VOW_LDAP_BIND_PASSWORD',
  'VOW_LDAP_ALLOW_BREAK_GLASS',
]);

export const SENSITIVE_CONFIG_PREFIXES: readonly string[] = [
  'VOW_OIDC_',
  'VOW_AUTHZ',
  'VOW_SESSION_',
  'VOW_LDAP_',
];

export function isSensitiveConfigKey(key: string): boolean {
  if (SENSITIVE_CONFIG_KEYS.has(key)) return true;
  return SENSITIVE_CONFIG_PREFIXES.some((p) => key.startsWith(p));
}
