import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { signInAgain } from '../auth/session';
import { useSession } from '../auth/store';
import { resetStore } from '../test-utils';
import { AuthGate } from './AuthGate';

vi.mock('../auth/session', () => ({ signInAgain: vi.fn() }));

function renderGate() {
  return render(
    <AuthGate>
      <p>Console</p>
    </AuthGate>,
  );
}

describe('AuthGate', () => {
  beforeEach(() => {
    resetStore(useSession);
    vi.mocked(signInAgain).mockReset();
  });

  it('shows the console once the operator is signed in', () => {
    useSession.getState().signedIn({ displayName: 'Demo Operator' });

    renderGate();

    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a busy screen instead of the console while signing in', () => {
    renderGate();

    expect(screen.getByRole('status')).toHaveTextContent('Signing in…');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Console')).toBeNull();
  });

  it('shows a busy screen instead of the console while signing out', () => {
    useSession.getState().setStatus('signing-out');

    renderGate();

    expect(screen.getByRole('status')).toHaveTextContent('Signing out…');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Console')).toBeNull();
  });

  it('explains that sign-in needs a secure context', () => {
    useSession.getState().setStatus('insecure-context');

    renderGate();

    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in needs HTTPS or localhost');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Console')).toBeNull();
  });

  it('offers to try again when sign-in failed', async () => {
    useSession.getState().setStatus('failed');
    renderGate();

    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in did not complete.');
    expect(screen.queryByText('Console')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(signInAgain).toHaveBeenCalledTimes(1);
  });

  it('keeps the console on screen under the expired-session banner', async () => {
    useSession.getState().signedIn({ displayName: 'Demo Operator' });
    useSession.getState().expire();
    renderGate();

    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired.');
    expect(screen.getByText('Console')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(signInAgain).toHaveBeenCalledTimes(1);
  });
});
