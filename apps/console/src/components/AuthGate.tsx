import type { ReactNode } from 'react';
import { signInAgain } from '../auth/session';
import { useSession } from '../auth/store';

/**
 * Renders the console only once the operator is signed in, so no query or socket starts without
 * a token. Every other session state gets a full-screen message instead.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const expired = useSession((s) => s.expired);

  switch (status) {
    case 'signed-in':
      return (
        <>
          {expired && <SessionExpiredBanner />}
          {children}
        </>
      );
    case 'signing-in':
      return <AuthScreen busy>Signing in…</AuthScreen>;
    case 'signing-out':
      return <AuthScreen busy>Signing out…</AuthScreen>;
    case 'insecure-context':
      return (
        <AuthScreen>
          Sign-in needs HTTPS or localhost. Open the console at http://localhost:18080, or serve it
          over HTTPS.
        </AuthScreen>
      );
    case 'failed':
      return (
        <AuthScreen action={<SignInButton>Try again</SignInButton>}>
          Sign-in did not complete.
        </AuthScreen>
      );
  }
}

/** Fixed over the console, so the layout and any half-filled form stay as they are. */
function SessionExpiredBanner() {
  return (
    <div className="session-banner" role="alert">
      Your session has expired.
      <SignInButton>Sign in again</SignInButton>
    </div>
  );
}

function AuthScreen({
  busy = false,
  action,
  children,
}: {
  busy?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="auth-screen" aria-busy={busy}>
      <h1 className="header-title">Operations</h1>
      <p role={busy ? 'status' : 'alert'}>{children}</p>
      {action}
    </main>
  );
}

function SignInButton({ children }: { children: ReactNode }) {
  return (
    <button type="button" className="button button-primary" onClick={() => void signInAgain()}>
      {children}
    </button>
  );
}
