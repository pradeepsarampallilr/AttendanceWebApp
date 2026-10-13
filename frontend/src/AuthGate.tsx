/**
 * Checks who is signed in before showing the app.
 * Shows loading, access denied or error screens, and shares the user's email and role with the rest of the app.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api, type Me } from './api';
import { CALLBACK_PATH, oktaAuth, signOut } from './auth';

type State =
  | { status: 'loading'; message: string }
  | { status: 'ready'; me: Me }
  | { status: 'denied'; email: string | null; identifiers: string[] }
  | { status: 'error'; message: string; hint?: string };

const UserContext = createContext<Me>({ email: null, role: null });
export const useUser = () => useContext(UserContext);

type Tone = 'neutral' | 'danger' | 'warn';

function OktaLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Okta">
      <path
        fill="#007DC1"
        fillRule="evenodd"
        d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Zm0 15.75a5.25 5.25 0 1 1 0-10.5 5.25 5.25 0 0 1 0 10.5Z"
      />
    </svg>
  );
}

function AppLogo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15l2.2 2.2L15.5 13" />
    </svg>
  );
}

function StatusIcon({ tone, busy }: { tone: Tone; busy: boolean }) {
  const cls = 'h-4 w-4';
  if (busy) {
    return (
      <svg viewBox="0 0 24 24" className={`${cls} animate-spin`} fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {tone === 'danger' ? (
        <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>
      ) : (
        <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17.2v.1" /></>
      )}
    </svg>
  );
}

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  danger: 'bg-rose-50 text-rose-600',
  warn: 'bg-amber-50 text-amber-600',
};

function Screen({ tone = 'neutral', busy = false, title, children }: {
  tone?: Tone; busy?: boolean; title: string; children: ReactNode;
}) {
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-50 via-white to-sky-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-6 text-slate-900">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-white shadow-sm">
            <AppLogo />
          </span>
          <span className="text-slate-300" aria-hidden>+</span>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white border border-slate-200 shadow-sm">
            <OktaLogo className="h-6 w-6" />
          </span>
        </div>
        <div className="bg-white/90 backdrop-blur border border-slate-200 rounded-2xl p-8 text-center shadow-lg shadow-slate-200/60">
          <span className={`mx-auto mb-4 grid h-9 w-9 place-items-center rounded-full ${TONES[tone]}`}>
            <StatusIcon tone={tone} busy={busy} />
          </span>
          <h1 className="font-semibold text-lg tracking-tight text-slate-900 mb-1">{title}</h1>
          {children}
        </div>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <OktaLogo className="h-3.5 w-3.5" /> Secured by Okta single sign-on
        </p>
      </div>
    </div>
  );
}


export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(
    oktaAuth ? { status: 'loading', message: 'Signing you in…' } : { status: 'ready', me: { email: null, role: null } },
  );

  useEffect(() => {
    if (!oktaAuth) return;
    let cancelled = false;
    const set = (s: State) => !cancelled && setState(s);
    (async () => {
      try {
        if (window.location.pathname === CALLBACK_PATH) {
          await oktaAuth!.handleRedirect(); // exchanges the code (PKCE) and stores tokens
          const back = oktaAuth!.getOriginalUri() || '/';
          oktaAuth!.removeOriginalUri();
          window.history.replaceState(null, '', back);
        }
        if (!(await oktaAuth!.isAuthenticated())) {
          set({ status: 'loading', message: 'Redirecting to Okta…' });
          oktaAuth!.setOriginalUri(window.location.pathname + window.location.search);
          await oktaAuth!.signInWithRedirect();
          return;
        }
        set({ status: 'loading', message: 'Checking your access…' });
        try {
          set({ status: 'ready', me: await api.me() });
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            return set({
              status: 'error',
              message: `Okta signed you in, but the API rejected the token${e.reason ? ` (${e.reason})` : ''}.`,
              hint: 'Usually the backend OKTA_ISSUER / OKTA_AUDIENCE do not match the token. Check the backend terminal for the exact reason.',
            });
          }
          if (e instanceof ApiError && e.status === 403) {
            const idToken = await oktaAuth?.tokenManager.get('idToken').catch(() => null);
            const claimEmail = (idToken && 'claims' in idToken ? idToken.claims?.email : undefined) ?? null;
            return set({ status: 'denied', email: e.email ?? claimEmail, identifiers: e.identifiers ?? [] });
          }
          throw e;
        }
      } catch (e) {
        set({ status: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  switch (state.status) {
    case 'ready':
      return <UserContext.Provider value={state.me}>{children}</UserContext.Provider>;
    case 'denied':
      return (
        <Screen tone="danger" title="Access denied">
          <p className="text-sm text-slate-500 mb-4">
            {state.email ? <><b>{state.email}</b> doesn't</> : "Your account doesn't"} have access to the Attendance
            Management System. It's limited to managers and HR. Ask an administrator to add your email or username.
          </p>
          {state.identifiers.length > 0 && (
            <p className="text-xs text-slate-400 mb-4">We checked: {state.identifiers.join(', ')}</p>
          )}
          <button className="btn btn-secondary" onClick={signOut}>Sign out / switch account</button>
        </Screen>
      );
    case 'error':
      return (
        <Screen tone="warn" title="Sign-in failed">
          <p className="text-sm text-slate-500 mb-2">{state.message}</p>
          {state.hint && <p className="text-xs text-slate-400 mb-4">{state.hint}</p>}
          <div className="flex justify-center gap-2 mt-4">
            <button className="btn btn-primary" onClick={() => window.location.assign('/')}>Try again</button>
            {oktaAuth && <button className="btn btn-secondary" onClick={signOut}>Sign out</button>}
          </div>
        </Screen>
      );
    default:
      return (
        <Screen busy title="Attendance Management System">
          <p className="text-sm text-slate-500" role="status">{state.message}</p>
        </Screen>
      );
  }
}
