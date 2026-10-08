import type { ReactNode } from 'react';
import { signInAgain } from '../auth/session';
import { useSession } from '../auth/store';
import { useSignOut } from '../auth/useSignOut';
import { Banner } from '../ui/Banner';
import { Button, type ButtonSize } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { CircleX, type Glyph, LoaderCircle, Lock, Shield } from '../ui/icons';
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
  const displayName = useSession((s) => s.user?.displayName);

  switch (status) {
    case 'signed-in':
      // Signing in again would return the same roles, so the only way out is another account.
      if (noRole) {
        // The account's name tells an administrator which account needs a role (brief, decision 2).
        return (
          <AuthScreen
            tone="warning"
            glyph={Shield}
            sub={displayName && `Signed in as ${displayName}`}
            action={<SignOutButton />}
          >
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
      return (
        <AuthScreen tone="busy" glyph={LoaderCircle}>
          Signing in…
        </AuthScreen>
      );
    case 'signing-out':
      return (
        <AuthScreen tone="busy" glyph={LoaderCircle}>
          Signing out…
        </AuthScreen>
      );
    case 'insecure-context':
      return (
        <AuthScreen tone="warning" glyph={Lock}>
          Sign-in needs HTTPS or localhost. Open the console at <code>http://localhost:18080</code>,
          or serve it over HTTPS.
        </AuthScreen>
      );
    case 'failed':
      return (
        <AuthScreen tone="danger" glyph={CircleX} action={<SignInButton>Try again</SignInButton>}>
          Sign-in did not complete.
        </AuthScreen>
      );
  }
}

/**
 * Fixed over the console, so the layout and any half-filled form stay as they are. Signing in again
 * is a full redirect (`signinRedirect`), so the second line says what it costs (brief, decision 2).
 */
function SessionExpiredBanner() {
  return (
    <Banner
      role="alert"
      icon={Lock}
      action={<SignInButton size="sm">Sign in again</SignInButton>}
      detail="Signing in again reloads the console — unsent notes and reports will be lost."
      className={styles.sessionBanner}
    >
      Your session has expired.
    </Banner>
  );
}

/**
 * Frames 08–11: the product on a card, then the state — a glyph in a toned circle, the message
 * (the live region: a status while busy, an alert otherwise), an optional secondary line and an
 * action. Only the busy glyph moves, and not under reduced motion.
 */
function AuthScreen({
  tone,
  glyph,
  sub,
  action,
  children,
}: {
  tone: 'busy' | 'warning' | 'danger';
  glyph: Glyph;
  /** Plain text under the message, outside the live region: read with the screen, not announced. */
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const busy = tone === 'busy';
  return (
    <main className={styles.screen} aria-busy={busy}>
      <div className={styles.card}>
        <Brand size="lg" />
        <div className={styles.state}>
          <span className={styles.stateIcon} data-tone={tone}>
            <Icon glyph={glyph} size={22} className={busy ? styles.spin : undefined} />
          </span>
          <p role={busy ? 'status' : 'alert'} className={styles.message}>
            {children}
          </p>
          {sub && <p className={styles.sub}>{sub}</p>}
          {action}
        </div>
      </div>
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

/** Secondary (frame 10): leaving is the only way out, but not an action to urge. */
function SignOutButton() {
  const signOut = useSignOut();
  return <Button onClick={signOut}>Sign out</Button>;
}
