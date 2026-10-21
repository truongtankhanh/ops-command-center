import { act, render, screen } from '@testing-library/react';
import { useSession } from '../../auth/store';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { WallSessionNotice } from './WallSessionNotice';

describe('WallSessionNotice', () => {
  beforeEach(() => {
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Wall', roles: ['viewer'] });
  });

  it('says nothing while the session is good', () => {
    render(<WallSessionNotice />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says the session is reconnecting while a renewal has failed, with nothing to press', async () => {
    const { container } = render(<WallSessionNotice />);

    act(() => useSession.getState().expire());

    expect(screen.getByRole('status')).toHaveTextContent('Session reconnecting…');
    expect(screen.queryByRole('button')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('goes when a renewal succeeds', () => {
    render(<WallSessionNotice />);
    act(() => useSession.getState().expire());

    act(() => useSession.getState().signedIn({ displayName: 'Wall', roles: ['viewer'] }));

    expect(screen.queryByRole('status')).toBeNull();
  });
});
