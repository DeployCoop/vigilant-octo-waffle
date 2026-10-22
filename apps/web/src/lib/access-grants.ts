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
 * The grant-context editor's form shape (Plan III §4.2). Field-for-field
 * the context, except the time window uses `datetime-local` input values
 * (local wall time, minute precision) and the two enums use 'any' for
 * "unconstrained" so every field always has a control value.
 */
export interface GrantContextFormValues {
  /** `datetime-local` value ('' = no lower bound). */
  notBefore: string;
  /** `datetime-local` value ('' = no upper bound). */
  notAfter: string;
  source: 'any' | 'loopback';
  authMethod: 'any' | 'session' | 'token' | 'oidc';
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Context → editor form values. Absent fields become unconstrained. */
export function contextToFormValues(
  context: GrantContext | undefined
): GrantContextFormValues {
  return {
    notBefore: context?.notBefore ? toDatetimeLocal(context.notBefore) : '',
    notAfter: context?.notAfter ? toDatetimeLocal(context.notAfter) : '',
    source: context?.source === 'loopback' ? 'loopback' : 'any',
    authMethod:
      context?.authMethod && context.authMethod !== 'any' ? context.authMethod : 'any',
  };
}

/**
 * Editor form values → context. A fully unconstrained form produces
 * `undefined`, so clearing every field removes the context entirely.
 */
export function formValuesToContext(
  values: GrantContextFormValues
): GrantContext | undefined {
  const out: GrantContext = {};
  const notBefore = fromDatetimeLocal(values.notBefore);
  if (notBefore) out.notBefore = notBefore;
  const notAfter = fromDatetimeLocal(values.notAfter);
  if (notAfter) out.notAfter = notAfter;
  if (values.source === 'loopback') out.source = 'loopback';
  if (values.authMethod !== 'any') out.authMethod = values.authMethod;
  return Object.keys(out).length > 0 ? out : undefined;
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
