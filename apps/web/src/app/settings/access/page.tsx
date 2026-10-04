'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  Key,
  RefreshCw,
  Plus,
  Trash2,
  Save,
  AlertCircle,
  Copy,
  X,
} from 'lucide-react';
import { useAbilityContext } from '@/lib/ability';
import { apiErrorMessage } from '@/lib/envelope';

interface Grant {
  permission: string;
  scope?: { appId?: string; namespace?: string };
}

interface PublicPrincipal {
  id: string;
  name: string;
  kind: string;
  role: string;
  oidcSubject?: string;
  disabled: boolean;
  grants: Grant[];
  revocations: string[];
  hasToken: boolean;
}

interface AuditEntry {
  ts: string;
  principalId: string | null;
  permission: string;
  allowed: boolean;
  reason: string;
  route: string;
}

interface TokenReveal {
  title: string;
  token: string;
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none';
const btnCls =
  'px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-50';
const primaryBtnCls =
  'px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-50 shadow-sm';

export default function AccessPage() {
  const { status, principal: me, signIn, signOut } = useAbilityContext();
  const [loading, setLoading] = useState(true);
  const [authzEnabled, setAuthzEnabled] = useState<boolean | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [principals, setPrincipals] = useState<PublicPrincipal[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<TokenReveal | null>(null);

  // Enable form
  const [ownerName, setOwnerName] = useState('Owner');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [enabling, setEnabling] = useState(false);

  // Create form
  const [createName, setCreateName] = useState('');
  const [createKind, setCreateKind] = useState('human');
  const [createRole, setCreateRole] = useState('viewer');
  const [createOidc, setCreateOidc] = useState('');

  // Editor state (per principal id)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('viewer');
  const [editDisabled, setEditDisabled] = useState(false);
  const [editGrants, setEditGrants] = useState<Grant[]>([]);
  const [editRevocations, setEditRevocations] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/authz/principals');
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        setAuthzEnabled(true);
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));
      setForbidden(false);
      setAuthzEnabled(Boolean(data.authzEnabled));
      setPrincipals(data.principals ?? []);
      setPermissions(data.permissions ?? []);
      setRoles(data.roles ?? []);
      if (data.authzEnabled) {
        const auditRes = await fetch('/api/authz/audit?limit=50');
        if (auditRes.ok) {
          const auditData = await auditRes.json();
          setAudit(auditData.entries ?? []);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = async (res: Response) => {
    const data = await res.json().catch(() => ({}));
    setError(apiErrorMessage(data, `Request failed (${res.status})`));
  };

  const handleEnable = async () => {
    setEnabling(true);
    setError(null);
    try {
      const res = await fetch('/api/authz/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ownerName,
          ...(ownerPassword.trim() ? { password: ownerPassword.trim() } : {}),
        }),
      });
      if (!res.ok) return await fail(res);
      const data = await res.json();
      setReveal({
        title: data.isCustomPassword
          ? `Initial owner password configured for ${data.principal.name}`
          : `Owner token for ${data.principal.name} — shown once`,
        token: data.token,
      });
      setMessage(
        'Authorization enabled! Stored credential in .vow/authz.yaml. The control plane will host TLS secured via mkcert.'
      );
      setOwnerPassword('');
      await load();
    } finally {
      setEnabling(false);
    }
  };

  const handleCreate = async () => {
    setError(null);
    setMessage(null);
    const res = await fetch('/api/authz/principals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: createName,
        kind: createKind,
        role: createRole,
        ...(createOidc.trim() ? { oidcSubject: createOidc.trim() } : {}),
      }),
    });
    if (!res.ok) return await fail(res);
    const data = await res.json();
    if (data.token) {
      setReveal({ title: `Token for ${data.principal.name} — shown once`, token: data.token });
    }
    setMessage(`Principal ${data.principal.name} created.`);
    setCreateName('');
    setCreateOidc('');
    await load();
  };

  const startEdit = (p: PublicPrincipal) => {
    setEditingId(p.id);
    setEditRole(p.role);
    setEditDisabled(p.disabled);
    setEditGrants(p.grants.map((g) => ({ ...g, scope: g.scope ? { ...g.scope } : undefined })));
    setEditRevocations([...p.revocations]);
    setError(null);
  };

  const handleSaveEdit = async (p: PublicPrincipal) => {
    setError(null);
    const grants = editGrants
      .filter((g) => g.permission)
      .map((g) => {
        const scope: Grant['scope'] = {};
        if (g.scope?.appId?.trim()) scope.appId = g.scope.appId.trim();
        if (g.scope?.namespace?.trim()) scope.namespace = g.scope.namespace.trim();
        return Object.keys(scope).length ? { permission: g.permission, scope } : { permission: g.permission };
      });
    const res = await fetch(`/api/authz/principals/${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: editRole,
        grants,
        revocations: editRevocations,
        disabled: editDisabled,
      }),
    });
    if (!res.ok) return await fail(res);
    setMessage(`${p.name} updated.`);
    setEditingId(null);
    await load();
  };

  const handleToggleDisabled = async (p: PublicPrincipal) => {
    setError(null);
    const res = await fetch(`/api/authz/principals/${encodeURIComponent(p.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: p.role,
        grants: p.grants,
        revocations: p.revocations,
        disabled: !p.disabled,
      }),
    });
    if (!res.ok) return await fail(res);
    await load();
  };

  const handleRotate = async (p: PublicPrincipal) => {
    setError(null);
    const res = await fetch(`/api/authz/principals/${encodeURIComponent(p.id)}/rotate`, {
      method: 'POST',
    });
    if (!res.ok) return await fail(res);
    const data = await res.json();
    setReveal({ title: `New token for ${p.name} — shown once`, token: data.token });
    await load();
  };

  const handleDelete = async (p: PublicPrincipal) => {
    if (!window.confirm(`Remove principal ${p.name} (${p.id})? This cannot be undone.`)) return;
    setError(null);
    const res = await fetch(`/api/authz/principals/${encodeURIComponent(p.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return await fail(res);
    setMessage(`${p.name} removed.`);
    await load();
  };

  const roleBadge = (role: string) =>
    role === 'owner'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : role === 'admin'
        ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
        : role === 'operator'
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          : 'bg-slate-500/15 text-slate-300 border-slate-500/30';

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Access & Audit</h2>
          </div>
          <p className="text-sm text-slate-400">
            Principals, roles, and scoped grants for this deployment (Paperclip-style
            authorization, enforced by CASL). Changes write to <code>.vow/authz.yaml</code>.
          </p>
          {me && (
            <p className="text-xs text-slate-500">
              Signed in as <span className="text-slate-300">{me.name}</span> ({me.role})
            </p>
          )}
          {status === 'local-board' && (
            <p className="text-xs text-slate-500">
              Local board session — no token needed while you are on this machine and the
              store is empty or you browse locally.
            </p>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={() => void load()} className={btnCls} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {(status === 'ready' || status === 'unknown-principal') && (
            <button onClick={() => void signOut()} className={btnCls}>
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>Sign out of this browser</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start space-x-2 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-200">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm text-emerald-200">
          {message}
        </div>
      )}

      {reveal && (
        <div className="p-5 bg-amber-500/10 border border-amber-500/40 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-amber-200 flex items-center space-x-2">
              <Key className="w-4 h-4" />
              <span>{reveal.title}</span>
            </h3>
            <button
              onClick={() => setReveal(null)}
              className="text-slate-400 hover:text-slate-200"
              aria-label="Dismiss token"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-amber-100">
              {reveal.token}
            </code>
            <button
              className={btnCls}
              onClick={() => void navigator.clipboard?.writeText(reveal.token)}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </button>
            <button
              className={btnCls}
              onClick={() => {
                void signIn(reveal.token);
                setMessage('Token saved to this browser.');
              }}
            >
              <Save className="w-3.5 h-3.5" />
              <span>Use in this browser</span>
            </button>
          </div>
          <p className="text-xs text-amber-200/70">
            Only the hash is stored server-side. If you lose this token, rotate it — it
            cannot be recovered.
          </p>
        </div>
      )}

      {loading && <p className="text-sm text-slate-400">Loading access state…</p>}

      {!loading && authzEnabled === false && (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <h3 className="text-base font-semibold text-white">Authorization is off</h3>
          <p className="text-sm text-slate-400 max-w-2xl">
            Right now the control plane relies on localhost-only access plus the optional
            shared token. Enable authorization to provision per-person and per-service
            principals with roles and scoped grants. This creates{' '}
            <code>.vow/authz.yaml</code> and a first owner principal — keep the owner token
            safe, it is the key to this page afterwards.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-400">Owner name</span>
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-400">
                Initial admin password <span className="text-slate-500 font-normal">(optional, or auto-generates token)</span>
              </span>
              <input
                type="password"
                placeholder="Leave blank to auto-generate token"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
          <div className="flex justify-end pt-1">
            <button onClick={() => void handleEnable()} disabled={enabling} className={primaryBtnCls}>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{enabling ? 'Enabling…' : 'Enable authorization & TLS'}</span>
            </button>
          </div>
        </div>
      )}

      {!loading && forbidden && (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
          <h3 className="text-base font-semibold text-white">Owners only</h3>
          <p className="text-sm text-slate-400 max-w-2xl">
            Managing principals requires the <code>users:manage_permissions</code>{' '}
            permission, which only the owner role holds. Ask an owner to grant you access,
            or sign in with an owner token.
          </p>
        </div>
      )}

      {!loading && authzEnabled && !forbidden && (
        <>
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-white">Principals</h3>
            {principals.length === 0 && (
              <p className="text-sm text-slate-400">
                No principals yet — the store is in bootstrap mode. Create the first owner
                below.
              </p>
            )}
            {principals.map((p) => (
              <div key={p.id} className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-100">{p.name}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${roleBadge(p.role)}`}>
                      {p.role}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-600 text-slate-400">
                      {p.kind}
                    </span>
                    {p.disabled && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-red-500/40 text-red-300">
                        disabled
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{p.id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className={btnCls} onClick={() => startEdit(p)}>Edit</button>
                    <button className={btnCls} onClick={() => void handleRotate(p)}>Rotate token</button>
                    <button className={btnCls} onClick={() => void handleToggleDisabled(p)}>
                      {p.disabled ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      className={`${btnCls} hover:bg-red-500/20 hover:border-red-500/40`}
                      onClick={() => void handleDelete(p)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-slate-400 space-y-1">
                  <p>
                    Credentials: {p.hasToken ? 'token' : '—'}
                    {p.oidcSubject ? ` · OIDC subject ${p.oidcSubject}` : ''}
                  </p>
                  {p.grants.length > 0 && (
                    <p>
                      Grants:{' '}
                      {p.grants
                        .map(
                          (g) =>
                            g.permission +
                            (g.scope
                              ? ` (${[g.scope.appId && `app=${g.scope.appId}`, g.scope.namespace && `ns=${g.scope.namespace}`].filter(Boolean).join(', ')})`
                              : '')
                        )
                        .join(' · ')}
                    </p>
                  )}
                  {p.revocations.length > 0 && (
                    <p>Revocations: {p.revocations.join(' · ')}</p>
                  )}
                </div>

                {editingId === p.id && (
                  <div className="border-t border-slate-800 pt-4 space-y-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-slate-400">Role</span>
                        <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className={inputCls}>
                          {roles.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex items-center gap-2 pt-5">
                        <input
                          type="checkbox"
                          checked={editDisabled}
                          onChange={(e) => setEditDisabled(e.target.checked)}
                          className="h-4 w-4 accent-red-500"
                        />
                        <span className="text-sm text-slate-300">Disabled (cannot authenticate)</span>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300">Scoped grants</span>
                        <button
                          className={btnCls}
                          onClick={() =>
                            setEditGrants([...editGrants, { permission: permissions[0] ?? 'apps:read', scope: {} }])
                          }
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add grant</span>
                        </button>
                      </div>
                      {editGrants.map((g, i) => (
                        <div key={i} className="flex flex-wrap gap-2 items-center">
                          <select
                            value={g.permission}
                            onChange={(e) =>
                              setEditGrants(editGrants.map((x, j) => (j === i ? { ...x, permission: e.target.value } : x)))
                            }
                            className="flex-1 min-w-44 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                          >
                            {permissions.map((perm) => (
                              <option key={perm} value={perm}>{perm}</option>
                            ))}
                          </select>
                          <input
                            placeholder="app id (optional)"
                            value={g.scope?.appId ?? ''}
                            onChange={(e) =>
                              setEditGrants(editGrants.map((x, j) => (j === i ? { ...x, scope: { ...x.scope, appId: e.target.value } } : x)))
                            }
                            className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                          />
                          <input
                            placeholder="namespace (optional)"
                            value={g.scope?.namespace ?? ''}
                            onChange={(e) =>
                              setEditGrants(editGrants.map((x, j) => (j === i ? { ...x, scope: { ...x.scope, namespace: e.target.value } } : x)))
                            }
                            className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100"
                          />
                          <button
                            className={btnCls}
                            onClick={() => setEditGrants(editGrants.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-slate-300">
                        Revocations (subtract from the role defaults)
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {permissions.map((perm) => {
                          const active = editRevocations.includes(perm);
                          return (
                            <button
                              key={perm}
                              onClick={() =>
                                setEditRevocations(
                                  active
                                    ? editRevocations.filter((x) => x !== perm)
                                    : [...editRevocations, perm]
                                )
                              }
                              className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                                active
                                  ? 'bg-red-500/15 border-red-500/40 text-red-200'
                                  : 'border-slate-700 text-slate-400 hover:border-slate-500'
                              }`}
                            >
                              {perm}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2">
                      <button className={btnCls} onClick={() => setEditingId(null)}>Cancel</button>
                      <button className={primaryBtnCls} onClick={() => void handleSaveEdit(p)}>
                        <Save className="w-3.5 h-3.5" />
                        <span>Save changes</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <h3 className="text-base font-semibold text-white">Add a principal</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Name</span>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)} className={inputCls} placeholder="Ada Lovelace / ci-deployer" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-400">OIDC subject (optional — tokenless login)</span>
                <input value={createOidc} onChange={(e) => setCreateOidc(e.target.value)} className={inputCls} placeholder="sub or verified email" />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Kind</span>
                <select value={createKind} onChange={(e) => setCreateKind(e.target.value)} className={inputCls}>
                  <option value="human">human</option>
                  <option value="service">service</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Role</span>
                <select value={createRole} onChange={(e) => setCreateRole(e.target.value)} className={inputCls}>
                  {roles.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end">
              <button className={primaryBtnCls} disabled={!createName.trim()} onClick={() => void handleCreate()}>
                <Plus className="w-3.5 h-3.5" />
                <span>Create principal</span>
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Without an OIDC subject, a token is generated and shown once. With one, the
              principal signs in via your OIDC provider and no token exists.
            </p>
          </div>

          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
            <h3 className="text-base font-semibold text-white">Audit log</h3>
            {audit.length === 0 ? (
              <p className="text-sm text-slate-400">No audited decisions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Principal</th>
                      <th className="py-2 pr-3 font-medium">Permission</th>
                      <th className="py-2 pr-3 font-medium">Decision</th>
                      <th className="py-2 pr-3 font-medium">Reason</th>
                      <th className="py-2 font-medium">Route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry, i) => (
                      <tr key={i} className="border-b border-slate-800/60 text-slate-300">
                        <td className="py-2 pr-3 whitespace-nowrap">{new Date(entry.ts).toLocaleString()}</td>
                        <td className="py-2 pr-3">{entry.principalId ?? '—'}</td>
                        <td className="py-2 pr-3">{entry.permission}</td>
                        <td className="py-2 pr-3">
                          <span className={entry.allowed ? 'text-emerald-300' : 'text-red-300'}>
                            {entry.allowed ? 'allow' : 'DENY'}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{entry.reason}</td>
                        <td className="py-2">{entry.route}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-500">
              Every mutating decision and every denial is appended to <code>.vow/audit.log</code>.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
