import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { signInAgain, signOut } from '../auth/session';
import { useSession } from '../auth/store';
import { renderWithQueryClient, resetStore } from '../test-utils';
import { AuthGate } from './AuthGate';

vi.mock('../auth/session', () => ({ signInAgain: vi.fn(), signOut: vi.fn() }));

/** Inside a query client: signing out from the gate also clears the cache. */
function renderGate() {
  return renderWithQueryClient(
    <AuthGate>
      <p>Console</p>
    </AuthGate>,
  );
}

describe('AuthGate', () => {
  beforeEach(() => {
    resetStore(useSession);
    vi.mocked(signInAgain).mockReset();
    vi.mocked(signOut).mockReset();
  });

  it('shows the console once the operator is signed in', () => {
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });

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

  // Every state but the console renders the same screen, so one state proves the identity.
  it('names the product on the sign-in screens', () => {
    renderGate();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Ops Command Center' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Langbiang Tech Campus')).toBeInTheDocument();
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
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
    useSession.getState().expire();
    renderGate();

    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired.');
    expect(screen.getByText('Console')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(signInAgain).toHaveBeenCalledTimes(1);
  });

  describe('a user with no role', () => {
    beforeEach(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: [] }));

    it('tells the user that the account has no access', () => {
      renderGate();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'This account has no access to the console',
      );
      expect(screen.queryByText('Console')).toBeNull();
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sign in again' })).toBeNull();
    });

    it('shows no expired-session banner on the no-access screen', () => {
      useSession.getState().expire();

      renderGate();

      expect(screen.queryByText(/Your session has expired/)).toBeNull();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    });

    it('signs out and clears the cache', async () => {
      const { client } = renderGate();
      const clear = vi.spyOn(client, 'clear');

      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

      expect(signOut).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it('shows the console once a renewal grants a role', () => {
      renderGate();

      act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));

      expect(screen.getByText('Console')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
