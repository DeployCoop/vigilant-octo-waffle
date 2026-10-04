import { NextResponse } from 'next/server';
import { buildAbility } from '@vow/orchestrator';
import { resolveAuthzContext } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/**
 * Returns the caller's principal and their CASL rules in packed form so
 * the dashboard can gate UI controls with the exact rules the API
 * enforces. Doubles as the "who am I" probe for the login flow.
 */
export async function GET(req: Request) {
  const ctx = await resolveAuthzContext(req);

  if (ctx.loaded.status === 'disabled') {
    return NextResponse.json({ authzEnabled: false, principal: null, rules: [] });
  }

  if (ctx.loaded.status === 'invalid') {
    return NextResponse.json(
      { error: 'Authorization store is invalid', reason: 'deny_store_invalid' },
      { status: 500 }
    );
  }

  if (!ctx.principal) {
    // Bootstrap mode: empty store + local request = implicit local board.
    if (ctx.loaded.store.principals.length === 0 && ctx.localBoard) {
      return NextResponse.json({
        authzEnabled: true,
        principal: null,
        localBoard: true,
        rules: [],
      });
    }
    const reason = ctx.unknownPrincipal ? 'deny_unknown_principal' : 'deny_unauthenticated';
    return NextResponse.json(
      {
        error:
          reason === 'deny_unknown_principal'
            ? 'Identity is not provisioned as a principal'
            : 'Authentication required',
        reason,
      },
      { status: 401 }
    );
  }

  const { id, name, kind, role } = ctx.principal;
  return NextResponse.json({
    authzEnabled: true,
    principal: { id, name, kind, role },
    rules: buildAbility(ctx.principal).rules,
  });
}
