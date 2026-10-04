import type { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { signOut } from '../auth/session';
import { useSession } from '../auth/store';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { Header } from './Header';

vi.mock('../auth/session', () => ({ signOut: vi.fn() }));

describe('Header', () => {
  let client: QueryClient;

  beforeEach(() => {
    resetStore(useSession);
    resetStore(useConsole);
    vi.mocked(signOut).mockReset();
    useSession.getState().signedIn({ displayName: 'Demo Operator' });
    // useIncidents never goes stale, so a seeded list means no request. The pending fetch is a
    // guard: clearing the cache may refetch while the mocked signOut leaves the header mounted.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    client = createTestQueryClient();
    client.setQueryData(queryKeys.incidents, []);
    renderWithQueryClient(<Header />, client);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows who is signed in, with a way to sign out', () => {
    expect(screen.getByText('Demo Operator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('signs out and clears the cached data in one click', async () => {
    const clear = vi.spyOn(client, 'clear');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('starts signing out before it clears the cache', async () => {
    const clear = vi.spyOn(client, 'clear');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    // signOut() unmounts the console first, so nothing refetches into the emptied cache.
    expect(vi.mocked(signOut).mock.invocationCallOrder[0]).toBeLessThan(
      clear.mock.invocationCallOrder[0]!,
    );
  });
});
