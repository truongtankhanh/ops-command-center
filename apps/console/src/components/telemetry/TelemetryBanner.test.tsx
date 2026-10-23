import { act, fireEvent, render, screen } from '@testing-library/react';
import { initialTelemetryState, type TelemetryState } from '../../lib/telemetry/telemetryState';
import type { TelemetryClient } from '../../realtime/telemetryClient';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { TelemetryBanner } from './TelemetryBanner';

// Local times, so the text does not depend on the runner's timezone.
const pausedAt = new Date(2026, 9, 15, 15, 41, 20);
const lostAt = new Date(2026, 9, 15, 15, 44, 5);

const STILL_LIVE = 'Incidents and cameras are still live.';

/** Puts the telemetry store in a state, as the client would after a message. */
const setTelemetry = (patch: Partial<TelemetryState>) =>
  act(() =>
    useTelemetryStore.setState({
      view: { state: { ...initialTelemetryState, ...patch }, series: new Map() },
    }),
  );

const PAUSED: Partial<TelemetryState> = {
  socket: 'live',
  upstream: 'paused',
  upstreamSince: pausedAt.toISOString(),
};

const RECONNECTING: Partial<TelemetryState> = {
  socket: 'reconnecting',
  socketSince: lostAt.getTime(),
};

/** A client that only counts `retry`; `retryTelemetry` reaches it through the store. */
function fakeClient() {
  const client: TelemetryClient = {
    subscribe: () => () => {},
    getView: () => useTelemetryStore.getState().view,
    setWatch: vi.fn(),
    retry: vi.fn(),
    setLayout: vi.fn(() => 1),
    onTargets: vi.fn(() => () => {}),
    getTargets: vi.fn(() => null),
    getStats: vi.fn(() => ({ messages: 0, targetPosts: 0 })),
    dispose: vi.fn(),
  };
  act(() => useTelemetryStore.setState({ client }));
  return client;
}

describe('TelemetryBanner', () => {
  // The store is a module-level singleton: without a reset, one case's state leaks into the next.
  beforeEach(() => resetStore(useTelemetryStore));

  describe('copy', () => {
    it('says since when the API paused telemetry, on the API clock', () => {
      setTelemetry(PAUSED);

      render(<TelemetryBanner />);

      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('Telemetry paused since 15:41:20');
      expect(banner).toHaveTextContent(
        `Readings hold their last value and stop updating. ${STILL_LIVE}`,
      );
    });

    it('says since when this console lost its own telemetry socket', () => {
      setTelemetry(RECONNECTING);

      render(<TelemetryBanner />);

      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('Telemetry connection lost since 15:44:05');
      expect(banner).toHaveTextContent(
        'Reconnecting automatically. Readings hold their last value until it is back. ' +
          STILL_LIVE,
      );
    });

    it('tells the lost socket first when the upstream is paused too', () => {
      setTelemetry({ ...PAUSED, ...RECONNECTING });

      render(<TelemetryBanner />);

      expect(screen.getByRole('status')).toHaveTextContent('Telemetry connection lost since');
    });

    it.each([
      ['an unparseable time', { ...PAUSED, upstreamSince: 'not a time' }],
      ['no time', { ...PAUSED, upstreamSince: null }],
    ])('drops the since rather than print a bad time when there is %s', (_name, patch) => {
      setTelemetry(patch);

      render(<TelemetryBanner />);

      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('Telemetry paused');
      expect(banner).not.toHaveTextContent(/since|Invalid/);
    });
  });

  describe('when it shows', () => {
    it.each([
      ['connecting', {}],
      ['live', { socket: 'live', upstream: 'live' }],
      ['unavailable', { socket: 'unavailable' }],
    ] as const)('shows nothing while %s', (_state, patch) => {
      setTelemetry(patch);

      const { container } = render(<TelemetryBanner />);

      expect(screen.queryByRole('status')).toBeNull();
      expect(container).toBeEmptyDOMElement();
    });

    it('appears when the API pauses telemetry and clears by itself when it resumes', () => {
      setTelemetry({ socket: 'live', upstream: 'live' });
      render(<TelemetryBanner />);
      expect(screen.queryByRole('status')).toBeNull();

      setTelemetry(PAUSED);
      expect(screen.getByRole('status')).toHaveTextContent('Telemetry paused');

      setTelemetry({ socket: 'live', upstream: 'live', upstreamSince: null });
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('Reconnect', () => {
    afterEach(() => vi.useRealTimers());

    it('reconnects the telemetry socket once and disables itself for 5 seconds', () => {
      vi.useFakeTimers();
      const client = fakeClient();
      setTelemetry(PAUSED);
      render(<TelemetryBanner />);

      // `userEvent` hangs under fake timers (RTL asyncWrapper), so `fireEvent`.
      fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

      expect(client.retry).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled();

      act(() => void vi.advanceTimersByTime(4999));
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled();

      act(() => void vi.advanceTimersByTime(1));
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
    });

    it('keeps the cooldown when the press turns paused into reconnecting', () => {
      vi.useFakeTimers();
      fakeClient();
      setTelemetry(PAUSED);
      render(<TelemetryBanner />);

      fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
      // The engine marks the socket `reconnecting` at once; the banner stays and keeps its button.
      setTelemetry(RECONNECTING);

      expect(screen.getByRole('status')).toHaveTextContent('Telemetry connection lost');
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled();
    });

    it('does nothing, and does not throw, with no client mounted', () => {
      setTelemetry(PAUSED);
      render(<TelemetryBanner />);

      fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

      expect(screen.getByRole('status')).toHaveTextContent('Telemetry paused');
    });
  });

  describe('accessibility', () => {
    it('is one polite status with no violations, button included', async () => {
      setTelemetry(PAUSED);

      render(<TelemetryBanner />);

      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
      await expectNoAxeViolations();
    });
  });
});
