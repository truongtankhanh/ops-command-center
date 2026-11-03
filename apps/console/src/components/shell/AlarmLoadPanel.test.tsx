import { type Asset, ROLES, type Zone } from '@occ/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { chartLabel } from '../../lib/incidents/alarmChart';
import { RAISED_BUCKETS } from '../../lib/incidents/alarmLoad';
import type { AlarmLoad } from '../../lib/incidents/useAlarmLoad';
import { formatClockTime } from '../../lib/shared/time';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { AlarmLoadPanel } from './AlarmLoadPanel';

const MINUTE = 60_000;
const NOW = Date.parse('2026-10-01T12:00:30.000Z');

const ZONE: Zone = {
  id: '6f1c2b1e-0000-4000-8000-000000000001',
  code: 'BLD-DC',
  name: 'Data centre',
  kind: 'building',
  polygon: [],
  center: [108.44, 11.95],
};

const asset = (code: string, name: string): Asset => ({
  id: `asset-${code}`,
  code,
  name,
  class: {
    id: 'class-router',
    code: 'router',
    name: 'Router',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: ZONE.id,
  position: ZONE.center,
  elevationM: 0,
  headingDeg: 0,
  headline: [],
});
const ROUTER = asset('RT-01', 'Core router');
const SWITCH = asset('SW-02', 'Edge switch');

const counts = (at: Record<number, number>): number[] => {
  const buckets = Array.from({ length: RAISED_BUCKETS }, () => 0);
  for (const [index, count] of Object.entries(at)) buckets[Number(index)] = count;
  return buckets;
};

/** A loaded, calm model with two noisy devices; a case overrides what it is about. */
const load = (overrides: Partial<AlarmLoad> = {}): AlarmLoad => ({
  loaded: true,
  failed: false,
  now: NOW,
  rate: 3,
  flood: { flooding: false, since: null, rate: 3 },
  standing: 2,
  noisy: [
    { assetCode: 'RT-01', name: 'Core router', count: 7 },
    { assetCode: 'SW-02', name: 'Edge switch', count: 4 },
  ],
  noisyKnown: true,
  buckets: counts({ 13: 6, 17: 3 }),
  partial: false,
  ...overrides,
});

const NOTE = 'The incident list is full, so these figures are at least what is shown.';

describe('AlarmLoadPanel', () => {
  const close = vi.fn();

  // The panel reads the catalogue and the zones for its rows; seeded reference data makes no request.
  function renderPanel(model: AlarmLoad) {
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.assets, [ROUTER, SWITCH]);
    client.setQueryData(queryKeys.zones, [ZONE]);
    return renderWithQueryClient(<AlarmLoadPanel load={model} close={close} />, client);
  }

  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    close.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  describe('the measures', () => {
    it('says the rate, that it is normal, and how many are standing', () => {
      const { container } = renderPanel(load());

      expect(container).toHaveTextContent('3 raised in 10 min');
      expect(container).toHaveTextContent('Normal');
      expect(container).toHaveTextContent('2 open past their attention time');
      expect(container).not.toHaveTextContent('Flood');
    });

    it('says a flood in words, with the time it began', () => {
      const since = NOW - 5 * MINUTE;
      const { container } = renderPanel(
        load({ rate: 14, flood: { flooding: true, since, rate: 14 } }),
      );

      expect(container).toHaveTextContent('14 raised in 10 min');
      expect(container).toHaveTextContent(`Flood since ${formatClockTime(since)}`);
      expect(container).not.toHaveTextContent('Normal');
    });

    it('says 0 for a quiet ten minutes once the list is known', () => {
      const { container } = renderPanel(load({ rate: 0, standing: 0, buckets: counts({ 5: 2 }) }));

      expect(container).toHaveTextContent('0 raised in 10 min');
      expect(container).toHaveTextContent('0 open past their attention time');
    });
  });

  describe('the chart', () => {
    it('is an image named by the window and the peak, which no row repeats', () => {
      const model = load();
      renderPanel(model);

      const chart = screen.getByRole('img', { name: chartLabel(model.buckets, NOW) });

      expect(chart).toBeInTheDocument();
      expect(chart).toHaveAccessibleName(
        /^Raised per 10 minutes over the last 3 hours, peak 6 at \d\d:\d\d$/,
      );
    });

    it('draws a bar for every bucket that has something in it', () => {
      renderPanel(load({ buckets: counts({ 2: 1, 9: 4, 17: 6 }) }));

      const chart = screen.getByRole('img');

      expect(chart.querySelectorAll('rect')).toHaveLength(3);
    });

    it('says nothing was raised in place of the chart alone, and keeps the other measures', () => {
      renderPanel(load({ rate: 0, buckets: counts({}) }));

      expect(screen.getByText('Nothing raised in the last 3 hours.')).toBeInTheDocument();
      expect(screen.queryByRole('img')).toBeNull();
      // The noisy devices look back 24 hours, so a quiet 3 hours does not hide them.
      expect(
        screen.getByRole('button', { name: 'RT-01, Core router, 7 raised' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/open past their attention time/)).toBeInTheDocument();
    });
  });

  describe('the noisy devices', () => {
    it('lists the rows in the model’s order, each named by code, name and count', () => {
      renderPanel(load());

      const list = screen.getByRole('list', { name: 'Noisy devices · last 24 h' });
      const names = within(list)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'));

      expect(names).toEqual(['RT-01, Core router, 7 raised', 'SW-02, Edge switch, 4 raised']);
    });

    it('puts the rows in the Tab order, in reading order', async () => {
      renderPanel(load());

      await userEvent.tab();
      expect(screen.getByRole('button', { name: /^RT-01/ })).toHaveFocus();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: /^SW-02/ })).toHaveFocus();
    });

    it('closes the panel and opens the asset in the inspector, focusing its building', async () => {
      renderPanel(load());

      await userEvent.click(screen.getByRole('button', { name: /^RT-01/ }));

      expect(close).toHaveBeenCalledOnce();
      expect(useConsole.getState().selectedAssetCode).toBe('RT-01');
      expect(useConsole.getState().focusZoneId).toBe(ZONE.id);
    });

    it.each(ROLES)('lets a %s open it: it selects, it does not act', async (role) => {
      useSession.setState({ status: 'signed-in', user: { displayName: 'Test', roles: [role] } });
      renderPanel(load());

      await userEvent.click(screen.getByRole('button', { name: /^SW-02/ }));

      expect(useConsole.getState().selectedAssetCode).toBe('SW-02');
    });

    it('does not say there are none before the catalogue is known', () => {
      renderPanel(load({ noisy: [], noisyKnown: false }));

      expect(screen.getByText('Loading noisy devices')).toBeInTheDocument();
      expect(screen.queryByText(/No device raised/)).toBeNull();
      expect(screen.queryByRole('list', { name: /Noisy devices/ })).toBeNull();
    });

    it('says there are none once the catalogue is known', () => {
      renderPanel(load({ noisy: [], noisyKnown: true }));

      expect(
        screen.getByText('No device raised an incident in the last 24 hours.'),
      ).toBeInTheDocument();
    });

    it('draws no row for an asset the catalogue does not have, never a raw code', () => {
      renderPanel(load({ noisy: [{ assetCode: 'GONE-9', name: 'Removed device', count: 5 }] }));

      expect(screen.queryByText('GONE-9')).toBeNull();
      expect(
        screen.getByText('No device raised an incident in the last 24 hours.'),
      ).toBeInTheDocument();
    });
  });

  describe('a full list', () => {
    it('says the figures are a minimum, and not that they are the most recent 200', () => {
      const { container } = renderPanel(load({ partial: true }));

      expect(screen.getByText(NOTE)).toBeInTheDocument();
      expect(container).not.toHaveTextContent(/200 most recent/);
    });

    it('says it when the chart is empty too, since the rate is a minimum then as well', () => {
      renderPanel(load({ partial: true, rate: 0, buckets: counts({}) }));

      expect(screen.getByText(NOTE)).toBeInTheDocument();
    });

    it('says nothing while the list is not full', () => {
      renderPanel(load({ partial: false }));

      expect(screen.queryByText(NOTE)).toBeNull();
    });
  });

  describe('the states before the numbers', () => {
    it('is a skeleton with one hidden "Loading", and no number, while the list is on its way', () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      const { container } = renderPanel(load({ loaded: false, rate: 0, standing: 0 }));

      expect(screen.getByText('Loading alarm load').parentElement).toHaveAttribute(
        'aria-busy',
        'true',
      );
      expect(container).not.toHaveTextContent(/raised in/);
      expect(container).not.toHaveTextContent(/open past/);
      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.queryByText(NOTE)).toBeNull();
    });

    it('says the list could not be loaded, which the bar’s dash does not', () => {
      const { container } = renderPanel(
        load({ loaded: false, failed: true, rate: 0, standing: 0 }),
      );

      expect(screen.getByText('The incident list could not be loaded.')).toBeInTheDocument();
      expect(container).not.toHaveTextContent(/raised in/);
      expect(screen.queryByText('Loading alarm load')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('has no live region and no button but the noisy rows', () => {
      renderPanel(load());

      expect(screen.queryAllByRole('status')).toHaveLength(0);
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('has no axe violations, calm, flooding, full, loading or failed', async () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      const flood = load({
        rate: 14,
        flood: { flooding: true, since: NOW - 5 * MINUTE, rate: 14 },
        partial: true,
      });
      const { unmount } = renderPanel(load());
      await expectNoAxeViolations();
      unmount();

      const second = renderPanel(flood);
      await expectNoAxeViolations();
      second.unmount();

      const third = renderPanel(load({ loaded: false, rate: 0 }));
      await expectNoAxeViolations();
      third.unmount();

      renderPanel(load({ loaded: false, failed: true }));
      await expectNoAxeViolations();
    });
  });
});
