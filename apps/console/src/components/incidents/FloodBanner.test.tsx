import type { Incident } from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { INCIDENT_LIST_LIMIT } from '../../lib/incidents/incidents';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { FloodBanner } from './FloodBanner';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

let sequence = 0;
/** Reported `ageMs` ago on the real clock, which the banner's own `useNow` reads. */
const raised = (ageMs = MINUTE): Incident => {
  sequence += 1;
  return {
    id: `i${sequence}`,
    code: `INC-${sequence}`,
    type: 'fire_alarm',
    severity: 'medium',
    status: 'open',
    title: `Incident ${sequence}`,
    description: null,
    zoneId: 'z1',
    position: [108.44, 11.95],
    source: 'operator',
    reportedAt: new Date(Date.now() - ageMs).toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
  };
};
const burst = (count: number, ageMs = MINUTE): Incident[] =>
  Array.from({ length: count }, () => raised(ageMs));

describe('FloodBanner', () => {
  beforeEach(() => {
    sequence = 0;
    resetStore(useConsole);
    // The catalogue (read by `useAlarmLoad` for the noisy devices) is never asked for in these cases.
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderBanner(
    incidents: Incident[] | null,
    client: QueryClient = createTestQueryClient(),
  ) {
    if (incidents) client.setQueryData(queryKeys.incidents, incidents);
    return renderWithQueryClient(<FloodBanner />, client);
  }

  describe('when it shows', () => {
    it('is not there before the list has arrived', () => {
      const { container } = renderBanner(null);

      expect(container).toBeEmptyDOMElement();
    });

    it('is not there for a calm list', () => {
      const { container } = renderBanner(burst(3));

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('is not there at exactly ten in ten minutes: a flood starts above ten', () => {
      const { container } = renderBanner(burst(10));

      expect(container).toBeEmptyDOMElement();
    });

    it('appears at the 11th', () => {
      renderBanner(burst(11));

      expect(screen.getByRole('status')).toHaveTextContent('Alarm flood: 11 raised in 10 min');
    });

    it('does not count an incident reported long before the window', () => {
      // 12 minutes old, so it is outside the 10-minute window at every minute the model replays since the burst began: at 10 minutes
      // and 1 second it would still have been inside the window a minute ago, and the replay would have started a flood then (and
      // held it, since the rate has not fallen below five).
      const { container } = renderBanner([...burst(10), raised(12 * MINUTE)]);

      expect(container).toBeEmptyDOMElement();
    });

    it('appears when the list grows past ten, announced as it is inserted', async () => {
      const client = createTestQueryClient();
      const { container } = renderBanner(burst(4), client);
      expect(container).toBeEmptyDOMElement();

      act(() => {
        client.setQueryData(queryKeys.incidents, [...burst(4), ...burst(7)]);
      });

      expect(await screen.findByRole('status')).toHaveTextContent('Alarm flood:');
    });
  });

  describe('what it says', () => {
    it('gives the rate and the rule, in the words of the model', () => {
      renderBanner(burst(14));

      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('Alarm flood: 14 raised in 10 min');
      expect(banner).toHaveTextContent('More than 10 in 10 minutes. It ends below 5.');
    });

    it('keeps the number out of the announcement: it sits in an aria-live="off" span', () => {
      renderBanner(burst(14));

      expect(screen.getByText('14')).toHaveAttribute('aria-live', 'off');
      expect(screen.getByRole('status')).not.toHaveAttribute('aria-live');
    });

    it('is a single live region, whose detail is fixed words', () => {
      renderBanner(burst(14));

      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
      expect(screen.getByRole('status').querySelectorAll('[aria-live]')).toHaveLength(1);
    });

    it('says "at least" while the cached list is full: every figure is a minimum then', () => {
      renderBanner(burst(INCIDENT_LIST_LIMIT));

      expect(screen.getByRole('status')).toHaveTextContent(
        `Alarm flood: at least ${INCIDENT_LIST_LIMIT} raised in 10 min`,
      );
    });

    it('does not say "at least" for a list that is not full', () => {
      renderBanner(burst(11));

      expect(screen.getByRole('status')).not.toHaveTextContent('at least');
    });
  });

  describe('what it offers', () => {
    it('has the switch and nothing else to press: no dismiss, no Alarm load button', () => {
      renderBanner(burst(11));

      expect(screen.getAllByRole('switch')).toHaveLength(1);
      expect(screen.getByRole('switch', { name: 'Group by zone' })).toBeInTheDocument();
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(screen.queryByText('Alarm load')).toBeNull();
    });

    it('starts with grouping off', () => {
      renderBanner(burst(11));

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      expect(useConsole.getState().groupByZone).toBe(false);
    });

    it('turns grouping on and off in the store', async () => {
      renderBanner(burst(11));

      await userEvent.click(screen.getByRole('switch'));
      expect(useConsole.getState().groupByZone).toBe(true);
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

      await userEvent.click(screen.getByRole('switch'));
      expect(useConsole.getState().groupByZone).toBe(false);
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    });

    it('is reachable by keyboard and toggled by Space and Enter', async () => {
      renderBanner(burst(11));
      await userEvent.tab();
      expect(screen.getByRole('switch')).toHaveFocus();

      await userEvent.keyboard(' ');
      expect(useConsole.getState().groupByZone).toBe(true);

      await userEvent.keyboard('{Enter}');
      expect(useConsole.getState().groupByZone).toBe(false);
    });

    it('does not move the camera, select anything or change the filters', async () => {
      useConsole.setState({ filter: 'all', severity: 'high' });
      const before = useConsole.getState();
      renderBanner(burst(11));

      await userEvent.click(screen.getByRole('switch'));

      const after = useConsole.getState();
      expect(after.selectedIncidentId).toBe(before.selectedIncidentId);
      expect(after.selectedAssetCode).toBe(before.selectedAssetCode);
      expect(after.focusZoneId).toBe(before.focusZoneId);
      expect(after.filter).toBe('all');
      expect(after.severity).toBe('high');
    });
  });

  describe('when the flood ends', () => {
    // The flood ends when the clock moves the burst out of the 10-minute window; only the clock's timers are faked.
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }));

    it('goes, and clears the choice to group', () => {
      renderBanner(burst(11, 10 * MINUTE - 10 * SECOND));
      fireEvent.click(screen.getByRole('switch'));
      expect(useConsole.getState().groupByZone).toBe(true);

      act(() => vi.advanceTimersByTime(15 * SECOND));

      expect(screen.queryByRole('status')).toBeNull();
      expect(useConsole.getState().groupByZone).toBe(false);
    });

    it('does not start the next flood already grouped', async () => {
      const client = createTestQueryClient();
      renderBanner(burst(11, 10 * MINUTE - 10 * SECOND), client);
      fireEvent.click(screen.getByRole('switch'));
      act(() => vi.advanceTimersByTime(15 * SECOND));
      expect(screen.queryByRole('status')).toBeNull();

      act(() => {
        client.setQueryData(queryKeys.incidents, burst(11, SECOND));
      });
      // TanStack tells the banner on a real `setTimeout(0)`; only the clock's timers are faked here.
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

      expect(screen.getByRole('status')).toHaveTextContent('Alarm flood:');
      expect(useConsole.getState().groupByZone).toBe(false);
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    });

    it('holds between five and ten: it ends below five, not below eleven', () => {
      renderBanner([...burst(11, 10 * MINUTE - 10 * SECOND), ...burst(6, MINUTE)]);
      expect(screen.getByRole('status')).toHaveTextContent('Alarm flood:');

      act(() => vi.advanceTimersByTime(15 * SECOND));

      // The 11 have left; 6 remain: above five, so the flood holds.
      expect(screen.getByRole('status')).toHaveTextContent('Alarm flood: 6 raised in 10 min');
    });
  });

  it('has no axe violations', async () => {
    renderBanner(burst(11));
    await expectNoAxeViolations();

    await userEvent.click(screen.getByRole('switch'));
    await expectNoAxeViolations();
  });
});
