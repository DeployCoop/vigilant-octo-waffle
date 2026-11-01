import { NextResponse } from 'next/server';
import {
  loadAuthzStore,
  saveAuthzStore,
  upsertPrincipal,
  generatePrincipalToken,
  hashToken,
  resolveVowLdapConfig,
  PERMISSIONS,
  ROLES,
  type AuthzStore,
  type Principal,
  type Role,
} from '@vow/orchestrator';
import { authorizeRequest, toPublicPrincipal, uniquePrincipalId } from '@/lib/authz';
import { getProjectRoot } from '@/lib/project';
import { apiError, routeError } from '@/lib/route-error';

export const dynamic = 'force-dynamic';

function notEnabled() {
  return apiError(
    409,
    'Authorization is not enabled yet. Initialize it via POST /api/authz/init or `vow authz init`.',
    { reason: 'authz_not_enabled' }
  );
}

function loadReadyStore(): AuthzStore | null {
  const loaded = loadAuthzStore(getProjectRoot());
  return loaded.status === 'ready' ? loaded.store : null;
}

function buildGroupRoleMapping(ldapCfg: ReturnType<typeof resolveVowLdapConfig>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of ldapCfg.viewerGroups) out[g] = 'viewer';
  for (const g of ldapCfg.operatorGroups) out[g] = 'operator';
  for (const g of ldapCfg.adminGroups) out[g] = 'admin';
  for (const g of ldapCfg.ownerGroups) out[g] = 'owner';
  return out;
}

/** Lists principals. Token hashes are never returned. */
export async function GET(req: Request) {
  const denied = await authorizeRequest(req, 'users:manage_permissions');
  if (denied) return denied;

  const projectRoot = getProjectRoot();
  const loaded = loadAuthzStore(projectRoot);
  if (loaded.status === 'disabled') {
    const ldapCfg = resolveVowLdapConfig({ projectRoot });
    return NextResponse.json({
      authzEnabled: false,
      principals: [],
      ...(ldapCfg.enabled
        ? {
            ldap: {
              enabled: true,
              url: ldapCfg.url,
              baseDn: ldapCfg.baseDn,
              groupRoleMapping: buildGroupRoleMapping(ldapCfg),
              autoProvisionPrincipals: ldapCfg.autoProvisionPrincipals,
              allowLocalBreakGlass: ldapCfg.allowLocalBreakGlass,
            },
          }
        : {}),
    });
  }
  if (loaded.status === 'invalid') {
    return apiError(500, 'Authorization store is invalid', {
      reason: 'deny_store_invalid',
      route: 'GET /api/authz/principals',
    });
  }
  const ldapCfg = resolveVowLdapConfig({ projectRoot, storeLdap: loaded.store.ldap });
  return NextResponse.json({
    authzEnabled: true,
    principals: loaded.store.principals.map(toPublicPrincipal),
    // The catalog ships with the response so the Access-page editor does
    // not need a second source of truth.
    permissions: [...PERMISSIONS],
    roles: [...ROLES],
    ...(ldapCfg.enabled
      ? {
          ldap: {
            enabled: true,
            url: ldapCfg.url,
            baseDn: ldapCfg.baseDn,
            groupRoleMapping: buildGroupRoleMapping(ldapCfg),
            autoProvisionPrincipals: ldapCfg.autoProvisionPrincipals,
            allowLocalBreakGlass: ldapCfg.allowLocalBreakGlass,
          },
        }
      : {}),
  });
}

/**
 * Creates a principal. Unless an `oidcSubject` or `ldapUid` is given, a token is
 * generated and returned in the response body **once** — only its hash
 * is stored.
 */
export async function POST(req: Request) {
  const denied = await authorizeRequest(req, 'users:manage_permissions');
  if (denied) return denied;

  const store = loadReadyStore();
  if (!store) return notEnabled();

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const role = body.role as Role;
  const kind = body.kind === 'service' ? 'service' : 'human';
  const oidcSubject =
    typeof body.oidcSubject === 'string' && body.oidcSubject.trim()
      ? body.oidcSubject.trim()
      : undefined;
  const ldapUid =
    typeof body.ldapUid === 'string' && body.ldapUid.trim()
      ? body.ldapUid.trim()
      : undefined;

  if (!name) {
    return apiError(400, 'A non-empty name is required');
  }
  if (!ROLES.includes(role)) {
    return apiError(400, `role must be one of: ${ROLES.join(', ')}`);
  }

  const token = oidcSubject || ldapUid ? null : generatePrincipalToken();
  const principal: Principal = {
    id: uniquePrincipalId(store, name),
    name,
    kind,
    role,
    ...(oidcSubject ? { oidcSubject } : {}),
    ...(ldapUid ? { ldapUid } : {}),
    ...(token ? { tokenHash: hashToken(token) } : {}),
    ...(Array.isArray(body.grants) ? { grants: body.grants } : {}),
    ...(Array.isArray(body.revocations) ? { revocations: body.revocations } : {}),
  };

  try {
    const next = upsertPrincipal(store, principal);
    saveAuthzStore(getProjectRoot(), next);
  } catch (err) {
    return routeError(err, { route: 'POST /api/authz/principals', status: 400 });
  }

  return NextResponse.json(
    { principal: toPublicPrincipal(principal), ...(token ? { token } : {}) },
    { status: 201 }
  );
}
