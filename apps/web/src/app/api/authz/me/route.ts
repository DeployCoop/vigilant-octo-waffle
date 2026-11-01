import { NextResponse } from 'next/server';
import { buildAbility, resolveVowLdapConfig, SESSION_COOKIE_NAME } from '@vow/orchestrator';
import { recordAuthEvent, resolveAuthzContext } from '@/lib/authz';
import { getProjectRoot } from '@/lib/project';
import { apiError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

/**
 * Returns the caller's principal and their CASL rules in packed form so
 * the dashboard can gate UI controls with the exact rules the API
 * enforces. Doubles as the "who am I" probe for the login flow.
 */
export async function GET(req: Request) {
  const ctx = await resolveAuthzContext(req);
  const storeLdap = ctx.loaded.status === 'ready' ? ctx.loaded.store.ldap : undefined;
  const ldapCfg = resolveVowLdapConfig({ projectRoot: getProjectRoot(), storeLdap });
  const ldapSummary = ldapCfg.enabled
    ? {
        enabled: true,
        url: ldapCfg.url,
        baseDn: ldapCfg.baseDn,
        allowLocalBreakGlass: ldapCfg.allowLocalBreakGlass,
      }
    : undefined;

  // Expired session (WS5): audit it here — the /me probe is the browser's
  // first call after expiry — and clear the dead cookie on the way out.
  if (ctx.expiredSession) {
    recordAuthEvent(req, 'session_expired', null);
  }

  if (ctx.loaded.status === 'disabled') {
    return NextResponse.json({
      authzEnabled: false,
      principal: null,
      rules: [],
      ...(ldapSummary ? { ldap: ldapSummary } : {}),
    });
  }

  if (ctx.loaded.status === 'invalid') {
    return apiError(500, 'Authorization store is invalid', {
      reason: 'deny_store_invalid',
      route: 'GET /api/authz/me',
    });
  }

  if (!ctx.principal) {
    // Bootstrap mode: empty store + local request = implicit local board.
    if (ctx.loaded.store.principals.length === 0 && ctx.localBoard) {
      return NextResponse.json({
        authzEnabled: true,
        principal: null,
        localBoard: true,
        rules: [],
        ...(ldapSummary ? { ldap: ldapSummary } : {}),
      });
    }
    const reason = ctx.unknownPrincipal ? 'deny_unknown_principal' : 'deny_unauthenticated';
    const res = apiError(
      401,
      reason === 'deny_unknown_principal'
        ? 'Identity is not provisioned as a principal'
        : 'Authentication required',
      { reason, ...(ldapSummary ? { ldap: ldapSummary } : {}) }
    );
    if (ctx.expiredSession) {
      res.cookies.set(SESSION_COOKIE_NAME, '', {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 0,
      });
    }
    return res;
  }

  const { id, name, kind, role, ldapUid, ldapGroups } = ctx.principal;
  return NextResponse.json({
    authzEnabled: true,
    principal: {
      id,
      name,
      kind,
      role,
      ...(ldapUid ? { ldapUid } : {}),
      ...(ldapGroups && ldapGroups.length > 0 ? { ldapGroups } : {}),
    },
    rules: buildAbility(ctx.principal).rules,
    ...(ldapSummary ? { ldap: ldapSummary } : {}),
  });
}
