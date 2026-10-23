import { act, render, screen } from '@testing-library/react';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { OfflineBanner } from './OfflineBanner';

// A local time, so the text does not depend on the runner's timezone.
const lostAt = new Date(2026, 9, 8, 15, 2).getTime();

describe('OfflineBanner', () => {
  // The store is a module-level singleton: without a reset, one case's link state leaks into the next.
  beforeEach(() => resetStore(useConsole));

  it('says since when live updates are paused', () => {
    useConsole.setState({ connection: 'offline', offlineSince: lostAt });

    render(<OfflineBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Live updates paused since 15:02 — data may be stale');
    expect(banner).toHaveTextContent(
      'Reconnecting automatically. This clears by itself once the connection is back.',
    );
  });

  it('shows nothing while the link is up', () => {
    const { container } = render(<OfflineBanner />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('clears by itself once the connection is back', () => {
    useConsole.setState({ connection: 'offline', offlineSince: lostAt });
    render(<OfflineBanner />);

    act(() => useConsole.getState().setConnection('live'));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('appears when the link is lost', () => {
    render(<OfflineBanner />);

    act(() => useConsole.getState().setConnection('offline', lostAt));

    expect(screen.getByRole('status')).toHaveTextContent('since 15:02');
  });
});
