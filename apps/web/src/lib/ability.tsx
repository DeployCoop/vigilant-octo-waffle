'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  abilityFromMe,
  emptyAbility,
  endSession,
  exchangeLdapCredentialsForSession,
  exchangeTokenForSession,
  subjectFor,
  type AbilityStatus,
  type ClientAbility,
  type MeLdapSummary,
  type MePrincipal,
  type MeResponse,
} from './ability-core';

interface AbilityContextValue {
  status: AbilityStatus;
  principal: MePrincipal | null;
  ldap: MeLdapSummary | null;
  can: (permission: string, target?: { appId?: string; namespace?: string }) => boolean;
  signIn: (token: string) => Promise<void>;
  signInWithLdap: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  openSignInPrompt: () => void;
}

const AbilityContext = createContext<AbilityContextValue>({
  status: 'loading',
  principal: null,
  ldap: null,
  can: () => false,
  signIn: async () => {},
  signInWithLdap: async () => {},
  signOut: async () => {},
  refresh: async () => {},
  openSignInPrompt: () => {},
});

export function useAbilityContext(): AbilityContextValue {
  return useContext(AbilityContext);
}

/** Convenience hook: `const canExec = useCan('k8s:exec', { namespace })`. */
export function useCan(
  permission: string,
  target?: { appId?: string; namespace?: string }
): boolean {
  const { can } = useAbilityContext();
  return can(permission, target);
}

/** Renders children only when the current principal may perform the action. */
export function Can({
  permission,
  target,
  children,
  fallback = null,
}: {
  permission: string;
  target?: { appId?: string; namespace?: string };
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = useCan(permission, target);
  return <>{allowed ? children : fallback}</>;
}

const PROMPT_DISMISSED_KEY = 'vow_token_prompt_dismissed';

export function AbilityProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AbilityStatus>('loading');
  const [principal, setPrincipal] = useState<MePrincipal | null>(null);
  const [ldap, setLdap] = useState<MeLdapSummary | null>(null);
  const [ability, setAbility] = useState<ClientAbility>(() => emptyAbility());
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'ldap' | 'token'>('token');
  const [tokenDraft, setTokenDraft] = useState('');
  const [ldapUserDraft, setLdapUserDraft] = useState('');
  const [ldapPasswordDraft, setLdapPasswordDraft] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/authz/me');
      const rawBody = (await res.json().catch(() => null)) as
        | (MeResponse & { error?: { ldap?: MeLdapSummary; reason?: string } })
        | null;
      const body: MeResponse | null = rawBody
        ? {
            ...rawBody,
            reason: rawBody.reason ?? rawBody.error?.reason,
            ldap: rawBody.ldap ?? rawBody.error?.ldap,
          }
        : null;
      const derived = abilityFromMe(body, res.status);
      setStatus(derived.status);
      setAbility(derived.ability);
      setPrincipal(body?.principal ?? null);
      if (body?.ldap) {
        setLdap(body.ldap);
        if (body.ldap.enabled) setAuthTab('ldap');
      }
    } catch {
      setStatus('unauthenticated');
      setAbility(emptyAbility());
      setPrincipal(null);
    }
  }, []);

  useEffect(() => {
    try {
      setPromptDismissed(window.sessionStorage.getItem(PROMPT_DISMISSED_KEY) === '1');
    } catch {
      // ignore
    }
    void refresh();
  }, [refresh]);

  const openSignInPrompt = useCallback(() => {
    setPromptOpen(true);
  }, []);

  const signIn = useCallback(
    async (token: string) => {
      // WS5: the token is exchanged once for an httpOnly session cookie
      // and never stored in the browser.
      const ok = await exchangeTokenForSession(token.trim());
      setSignInFailed(!ok);
      if (ok) setPromptOpen(false);
      await refresh();
    },
    [refresh]
  );

  const signInWithLdap = useCallback(
    async (username: string, password: string) => {
      const ok = await exchangeLdapCredentialsForSession(username.trim(), password);
      setSignInFailed(!ok);
      if (ok) {
        setLdapPasswordDraft('');
        setPromptOpen(false);
      }
      await refresh();
    },
    [refresh]
  );

  const signOut = useCallback(async () => {
    await endSession();
    setSignInFailed(false);
    await refresh();
  }, [refresh]);

  const can = useCallback(
    (permission: string, target?: { appId?: string; namespace?: string }) =>
      ability.can(permission, subjectFor(target)),
    [ability]
  );

  const value = useMemo<AbilityContextValue>(
    () => ({
      status,
      principal,
      ldap,
      can,
      signIn,
      signInWithLdap,
      signOut,
      refresh,
      openSignInPrompt,
    }),
    [status, principal, ldap, can, signIn, signInWithLdap, signOut, refresh, openSignInPrompt]
  );

  const dismissPrompt = () => {
    setPromptDismissed(true);
    setPromptOpen(false);
    try {
      window.sessionStorage.setItem(PROMPT_DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  };

  const showPrompt =
    promptOpen || ((status === 'unauthenticated' || status === 'unknown-principal') && !promptDismissed);

  return (
    <AbilityContext.Provider value={value}>
      {children}
      {showPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-slate-100">
              {status === 'unknown-principal'
                ? 'Identity not provisioned'
                : authTab === 'ldap'
                  ? 'Sign in with OpenLDAP Directory'
                  : 'Sign in with a principal token'}
            </h2>
            {ldap?.enabled && (
              <div className="mt-3 flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('ldap');
                    setSignInFailed(false);
                  }}
                  className={`flex-1 rounded-md py-1.5 transition-colors ${
                    authTab === 'ldap'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  OpenLDAP Directory
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('token');
                    setSignInFailed(false);
                  }}
                  className={`flex-1 rounded-md py-1.5 transition-colors ${
                    authTab === 'token'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Principal Token
                </button>
              </div>
            )}
            <p className="mt-2 text-sm text-slate-400">
              {status === 'unknown-principal'
                ? 'Your identity was verified but is not provisioned as a principal. Ask an owner to add you on the Access page, or continue with a principal token instead.'
                : signInFailed
                  ? authTab === 'ldap'
                    ? 'Directory authentication failed. Check your username and password.'
                    : 'That token was not accepted. Paste a valid principal token to continue.'
                  : authTab === 'ldap'
                    ? `Sign in with your Axonwall OpenLDAP account (${ldap?.baseDn ?? 'directory'}) or break-glass owner credentials.`
                    : 'Authorization is enabled for this deployment. Paste your principal token (issued by `vow authz add` or the Access page) to continue.'}
            </p>
            {authTab === 'ldap' ? (
              <div className="mt-4 space-y-3">
                <input
                  type="text"
                  value={ldapUserDraft}
                  onChange={(e) => setLdapUserDraft(e.target.value)}
                  placeholder="Directory UID (e.g. alice)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
                <input
                  type="password"
                  value={ldapPasswordDraft}
                  onChange={(e) => setLdapPasswordDraft(e.target.value)}
                  placeholder="Password"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && ldapUserDraft.trim() && ldapPasswordDraft) {
                      setSigningIn(true);
                      void signInWithLdap(ldapUserDraft, ldapPasswordDraft).finally(() =>
                        setSigningIn(false)
                      );
                    }
                  }}
                />
              </div>
            ) : (
              <input
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder="vow_…"
                className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tokenDraft.trim()) {
                    setSigningIn(true);
                    void signIn(tokenDraft).finally(() => setSigningIn(false));
                  }
                }}
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={dismissPrompt}
                className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                Browse read-only
              </button>
              {authTab === 'ldap' ? (
                <button
                  disabled={!ldapUserDraft.trim() || !ldapPasswordDraft || signingIn}
                  onClick={() => {
                    setSigningIn(true);
                    void signInWithLdap(ldapUserDraft, ldapPasswordDraft).finally(() =>
                      setSigningIn(false)
                    );
                  }}
                  className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {signingIn ? 'Signing in…' : 'Sign in with LDAP'}
                </button>
              ) : (
                <button
                  disabled={!tokenDraft.trim() || signingIn}
                  onClick={() => {
                    setSigningIn(true);
                    void signIn(tokenDraft).finally(() => setSigningIn(false));
                  }}
                  className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {signingIn ? 'Checking…' : 'Save token'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AbilityContext.Provider>
  );
}
