import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * OIDC identity verification for the authz system (plan §6.4).
 *
 * When `VOW_OIDC_ISSUER` and `VOW_OIDC_CLIENT_ID` are configured, a bearer
 * JWT is verified against the issuer's JWKS (discovered via the standard
 * `/.well-known/openid-configuration` document) using `jose` — signature,
 * issuer, audience, and expiry are all checked. The verified `sub` (and,
 * as a fallback, the verified `email` claim) is then matched to a
 * principal's `oidcSubject` by the caller (`findPrincipalByOidcSubject`).
 *
 * Any issuer works; the app catalog's Keycloak is the reference IdP.
 * Verification failures of any kind return null — never an exception —
 * so callers can treat the result as "not an OIDC identity".
 */

export const OIDC_ISSUER_ENV = 'VOW_OIDC_ISSUER';
export const OIDC_CLIENT_ID_ENV = 'VOW_OIDC_CLIENT_ID';

export interface OidcConfig {
  issuer: string;
  clientId: string;
}

export interface OidcIdentity {
  subject: string;
  email?: string;
}

/** Returns the OIDC config when both env vars are set, else null. */
export function getOidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const issuer = env[OIDC_ISSUER_ENV]?.trim();
  const clientId = env[OIDC_CLIENT_ID_ENV]?.trim();
  if (!issuer || !clientId) return null;
  return { issuer: issuer.replace(/\/+$/, ''), clientId };
}

/** Cheap structural check: three base64url segments. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

/** Clears the cached JWKS getters (tests and config rotation). */
export function clearOidcCache(): void {
  jwksCache.clear();
}

async function getJwks(issuer: string): Promise<JWTVerifyGetKey> {
  const cached = jwksCache.get(issuer);
  if (cached) return cached;

  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed for ${issuer}: HTTP ${res.status}`);
  }
  const doc = (await res.json()) as { jwks_uri?: unknown };
  if (typeof doc.jwks_uri !== 'string' || doc.jwks_uri === '') {
    throw new Error(`OIDC discovery document for ${issuer} has no jwks_uri`);
  }

  const jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
  jwksCache.set(issuer, jwks);
  return jwks;
}

/**
 * Verifies an OIDC ID token and returns its identity, or null when the
 * token is not a valid ID token for the configured issuer/audience
 * (bad signature, wrong issuer/audience, expired, unreachable IdP, ...).
 */
export async function verifyOidcToken(
  token: string,
  config: OidcConfig
): Promise<OidcIdentity | null> {
  try {
    const jwks = await getJwks(config.issuer);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.clientId,
    });
    if (!payload.sub) return null;
    return {
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}
