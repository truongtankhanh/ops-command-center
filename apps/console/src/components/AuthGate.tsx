import type { ReactNode } from 'react';
import { signInAgain } from '../auth/session';
import { useSession } from '../auth/store';
import { useSignOut } from '../auth/useSignOut';
import { Banner } from '../ui/Banner';
import { Button, type ButtonSize } from '../ui/Button';
import { Lock } from '../ui/icons';
import styles from './AuthGate.module.css';
import { Brand } from './Brand';

/**
 * Renders the console only once the operator is signed in with a role, so no query or socket
 * starts without a token, or with one the API would refuse (ADR-0011). Every other session state
 * gets a full-screen message instead.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const expired = useSession((s) => s.expired);
  // Derived, not a status: a renewal that grants a role brings the console back by itself.
  const noRole = useSession((s) => s.user?.roles.length === 0);

  switch (status) {
    case 'signed-in':
      // Signing in again would return the same roles, so the only way out is another account.
      if (noRole) {
        return (
          <AuthScreen action={<SignOutButton />}>
            This account has no access to the console. Ask an administrator to give it a role.
          </AuthScreen>
        );
      }
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
    <Banner
      role="alert"
      icon={Lock}
      action={<SignInButton size="sm">Sign in again</SignInButton>}
      className={styles.sessionBanner}
    >
      Your session has expired.
    </Banner>
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
    <main className={styles.screen} aria-busy={busy}>
      <Brand size="lg" />
      <p role={busy ? 'status' : 'alert'}>{children}</p>
      {action}
    </main>
  );
}

function SignInButton({ size, children }: { size?: ButtonSize; children: ReactNode }) {
  return (
    <Button variant="primary" size={size} onClick={() => void signInAgain()}>
      {children}
    </Button>
  );
}

function SignOutButton() {
  const signOut = useSignOut();
  return (
    <Button variant="primary" onClick={signOut}>
      Sign out
    </Button>
  );
}
