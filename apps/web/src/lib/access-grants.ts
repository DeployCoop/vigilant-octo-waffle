import type { GrantContext } from '@vow/orchestrator';

/**
 * Helpers for the Access (principals) editor's grant handling.
 *
 * WS5 grants can carry a request-context constraint (`Grant.context`:
 * time window, source, auth method) that is set via the CLI or API. The
 * editor's save path must round-trip that context untouched — rebuilding
 * a grant as `{ permission, scope }` silently strips it (Plan III §4.1).
 */

export interface EditableGrant {
  permission: string;
  scope?: { appId?: string; namespace?: string };
  context?: GrantContext;
}

/**
 * Serialize one edited grant for the principals PATCH body: trims scope
 * fields, drops an empty scope, and preserves any context constraint
 * verbatim (as a copy, so later edits cannot mutate the loaded grant).
 */
export function serializeGrantForSave(grant: EditableGrant): EditableGrant {
  const out: EditableGrant = { permission: grant.permission };
  const scope: NonNullable<EditableGrant['scope']> = {};
  if (grant.scope?.appId?.trim()) scope.appId = grant.scope.appId.trim();
  if (grant.scope?.namespace?.trim()) scope.namespace = grant.scope.namespace.trim();
  if (Object.keys(scope).length > 0) out.scope = scope;
  if (grant.context && Object.keys(grant.context).length > 0) {
    out.context = { ...grant.context };
  }
  return out;
}

/**
 * One-line rendering of a grant context, mirroring the authz CLI's
 * `{src=loopback auth=session from=… until=…}` style. 'any' values are
 * the unconstrained default and are omitted, as the CLI omits them.
 * Returns '' when there is nothing constraining to show.
 */
export function formatGrantContext(context: GrantContext | undefined): string {
  if (!context) return '';
  const parts: string[] = [];
  if (context.source && context.source !== 'any') parts.push(`src=${context.source}`);
  if (context.authMethod && context.authMethod !== 'any') {
    parts.push(`auth=${context.authMethod}`);
  }
  if (context.notBefore) parts.push(`from=${context.notBefore}`);
  if (context.notAfter) parts.push(`until=${context.notAfter}`);
  return parts.join(' ');
}
