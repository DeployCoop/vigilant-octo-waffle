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
  installAuthFetchInterceptor,
  readStoredToken,
  storeToken,
  subjectFor,
  type AbilityStatus,
  type ClientAbility,
  type MePrincipal,
  type MeResponse,
} from './ability-core';

interface AbilityContextValue {
  status: AbilityStatus;
  principal: MePrincipal | null;
  can: (permission: string, target?: { appId?: string; namespace?: string }) => boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  openSignInPrompt: () => void;
}

const AbilityContext = createContext<AbilityContextValue>({
  status: 'loading',
  principal: null,
  can: () => false,
  signIn: async () => {},
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
  const [ability, setAbility] = useState<ClientAbility>(() => emptyAbility());
  const [promptDismissed, setPromptDismissed] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/authz/me');
      const body = (await res.json().catch(() => null)) as MeResponse | null;
      const derived = abilityFromMe(body, res.status);
      setStatus(derived.status);
      setAbility(derived.ability);
      setPrincipal(body?.principal ?? null);
    } catch {
      setStatus('unauthenticated');
      setAbility(emptyAbility());
      setPrincipal(null);
    }
  }, []);

  useEffect(() => {
    installAuthFetchInterceptor();
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
      storeToken(token.trim());
      setPromptOpen(false);
      await refresh();
    },
    [refresh]
  );

  const signOut = useCallback(async () => {
    storeToken(null);
    await refresh();
  }, [refresh]);

  const can = useCallback(
    (permission: string, target?: { appId?: string; namespace?: string }) =>
      ability.can(permission, subjectFor(target)),
    [ability]
  );

  const value = useMemo<AbilityContextValue>(
    () => ({ status, principal, can, signIn, signOut, refresh, openSignInPrompt }),
    [status, principal, can, signIn, signOut, refresh, openSignInPrompt]
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
  const hasStoredToken = typeof window !== 'undefined' && readStoredToken() !== null;

  return (
    <AbilityContext.Provider value={value}>
      {children}
      {showPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-slate-100">
              {status === 'unknown-principal'
                ? 'Identity not provisioned'
                : 'Sign in with a principal token'}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {status === 'unknown-principal'
                ? 'Your identity was verified but is not provisioned as a principal. Ask an owner to add you on the Access page, or continue with a principal token instead.'
                : hasStoredToken
                  ? 'The stored token was not accepted. Paste a valid principal token to continue.'
                  : 'Authorization is enabled for this deployment. Paste your principal token (issued by `vow authz add` or the Access page) to continue.'}
            </p>
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
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={dismissPrompt}
                className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                Browse read-only
              </button>
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
            </div>
          </div>
        </div>
      )}
    </AbilityContext.Provider>
  );
}
