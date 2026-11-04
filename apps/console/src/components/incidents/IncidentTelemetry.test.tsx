import type {
  AssetDetail,
  AssetTelemetrySample,
  Incident,
  TelemetryPoint,
  TelemetryRule,
} from '@occ/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TOO_MANY_REQUESTS } from '../../api/client';
import { getAccessToken, renewSession } from '../../auth/session';
import type { TelemetryTabState } from '../../lib/incidents/useIncidentTelemetry';
import { formatClockTime } from '../../lib/shared/time';
import {
  type AssetTelemetryState,
  initialTelemetryState,
} from '../../lib/telemetry/telemetryState';
import { seriesKey, type SeriesView } from '../../realtime/telemetryClient';
import type * as TelemetryStore from '../../realtime/telemetryStore';
import { useServerNow, useTelemetryStore } from '../../realtime/telemetryStore';
import { expectNoAxeViolations, renderWithQueryClient, resetStore } from '../../test-utils';
import { IncidentTelemetry } from './IncidentTelemetry';

// Spies on the clock: an ended watch must not follow it, an open one must.
vi.mock('../../realtime/telemetryStore', async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryStore>();
  return { ...actual, useServerNow: vi.fn(actual.useServerNow) };
});

// A past range (V3-23.3) reads the history route: the network is `fetch`, as in `queries.test.ts`.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const RECEIVED = '2026-10-16T08:00:00.000Z';
const RECEIVED_MS = Date.parse(RECEIVED);
const MIN = 60_000;
const HOUR = 60 * MIN;

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: 0,
  max: 3000,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
  ...overrides,
});

const FAN = point();
const TEMP = point({
  key: 'motorTempC',
  label: 'Motor temperature',
  unit: '°C',
  min: -40,
  max: 150,
  headline: null,
});
// Neither a headline point nor ruled: the asset inspector lists it under "All points", this tab does not.
const HUMIDITY = point({
  key: 'humidityPct',
  label: 'Humidity',
  unit: '%',
  min: 0,
  max: 100,
  headline: null,
});

const rule = (overrides: Partial<TelemetryRule> = {}): TelemetryRule => ({
  name: 'Motor over-temperature',
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 60,
  severity: 'critical',
  incidentType: 'equipment_fault',
  ...overrides,
});

const TOWER: AssetDetail = {
  id: 'asset-ct-01',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 14,
  headingDeg: 0,
  headline: [FAN],
  points: [FAN, TEMP, HUMIDITY],
  rules: [rule()],
};

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'incident-1',
  code: 'INC-000107',
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: 'Motor over-temperature — Cooling tower 1',
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: TOWER.id,
  reportedAt: RECEIVED,
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

const READY: TelemetryTabState = { status: 'ready', detail: TOWER };

const entry = (values: AssetTelemetryState['values']): AssetTelemetryState => ({
  online: true,
  receivedAt: RECEIVED,
  headline: values,
  values,
  keyReceivedAt: {},
});

/** A ring series: each pair is how long before the reading `RECEIVED` the point was taken, and its value. */
const series = (...readings: [agoMs: number, value: number][]): SeriesView => ({
  t: Float64Array.from(readings.map(([ago]) => RECEIVED_MS - ago)),
  v: Float32Array.from(readings.map(([, value]) => value)),
});

/** The API's clock `afterMs` after the reading was received. */
function hold(
  assets: Record<string, AssetTelemetryState>,
  afterMs = 400,
  byKey: Record<string, SeriesView> = {},
) {
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at: RECEIVED_MS + afterMs, mono: performance.now() },
          assets,
        },
        series: new Map(
          Object.entries(byKey).map(([key, view]) => [seriesKey('CT-01', key), view]),
        ),
      },
    }),
  );
}

// Inside a QueryClient since V3-23.3: the tab reads a past range with `useReadingSeries` (15 min sends nothing).
const renderTab = (state: TelemetryTabState = READY, raised: Incident = incident()) =>
  renderWithQueryClient(<IncidentTelemetry incident={raised} state={state} />);

const rowOf = (label: string) => screen.getByText(label).closest('li') as HTMLElement;
// The sparkline's viewBox; the glyphs beside it are 24 × 24 and also `aria-hidden`.
const sparkOf = (item: HTMLElement) => item.querySelector('svg[viewBox="0 0 96 28"]');
const HINT = 'Charts stop at the last reading; the gap is the outage.';
const RESOLVED = { status: 'resolved', resolvedAt: RECEIVED } as const;

describe('IncidentTelemetry', () => {
  beforeEach(() => {
    resetStore(useTelemetryStore);
    vi.mocked(useServerNow).mockClear();
  });

  describe('an open incident', () => {
    beforeEach(() =>
      hold({ 'CT-01': entry({ fanSpeedRpm: 1420, motorTempC: 92, humidityPct: 41 }) }, 400, {
        fanSpeedRpm: series([10 * MIN, 1000], [5 * MIN, 1200], [0, 1420]),
      }),
    );

    it('is "Live readings" with the headline and the ruled points', () => {
      renderTab();

      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      expect(rowOf('Fan speed')).toHaveTextContent('1,420');
      expect(rowOf('Motor temperature')).toHaveTextContent('92');
      expect(screen.getByText(/^Updated/)).toBeInTheDocument();
    });

    it('leaves out a point that is neither a headline nor ruled, and offers no "All points"', () => {
      renderTab();

      expect(screen.queryByText('Humidity')).toBeNull();
      expect(screen.queryByText(/All points/)).toBeNull();
    });

    it('draws a sparkline for a point that has a series', () => {
      renderTab();

      expect(sparkOf(rowOf('Fan speed'))).not.toBeNull();
    });

    it('gives a ruled point its rule line, and a reading past it the rule severity in words', () => {
      renderTab();

      const hot = rowOf('Motor temperature');
      expect(hot).toHaveTextContent('85');
      expect(hot).toHaveAttribute('data-severity', 'critical');
      expect(hot).toHaveTextContent('over its limit');
      expect(rowOf('Fan speed')).not.toHaveAttribute('data-severity');
    });

    it('follows the server clock', () => {
      renderTab();

      expect(useServerNow).toHaveBeenCalledWith(true);
    });

    it('reads the same for an acknowledged incident', () => {
      renderTab(READY, incident({ status: 'acknowledged', acknowledgedAt: RECEIVED }));

      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
    });
  });

  describe('a stale asset', () => {
    it('is "Last readings", dims the rows, says how old and explains the gap', () => {
      hold({ 'CT-01': entry({ fanSpeedRpm: 1420, motorTempC: 92 }) }, 72_000);

      renderTab();

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(rowOf('Fan speed')).toHaveAttribute('data-stale', 'true');
      expect(screen.getByText('1 min 12 s old')).toBeInTheDocument();
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });
  });

  describe('a resolved incident', () => {
    beforeEach(() =>
      hold({ 'CT-01': entry({ fanSpeedRpm: 1420 }) }, 400, {
        fanSpeedRpm: series([10 * MIN, 1000], [5 * MIN, 1200]),
      }),
    );

    it('is "Last readings" with the values the store still holds, and a dash for the rest', () => {
      renderTab(READY, incident(RESOLVED));

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(rowOf('Fan speed')).toHaveTextContent('1,420');
      expect(rowOf('Motor temperature')).toHaveTextContent('—');
      expect(rowOf('Fan speed')).toHaveAttribute('data-stale', 'true');
    });

    it('draws no freshness line, no sparkline and no outage hint', () => {
      renderTab(READY, incident(RESOLVED));

      expect(screen.queryByText(/^Updated/)).toBeNull();
      expect(screen.queryByText(/ old$/)).toBeNull();
      expect(sparkOf(rowOf('Fan speed'))).toBeNull();
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('does not follow the server clock', () => {
      renderTab(READY, incident(RESOLVED));

      expect(useServerNow).toHaveBeenCalledWith(false);
      expect(useServerNow).not.toHaveBeenCalledWith(true);
    });
  });

  describe('loading', () => {
    it('says so and draws a skeleton, not the readings', () => {
      renderTab({ status: 'loading' });

      expect(screen.getByRole('status')).toHaveTextContent('Loading readings…');
      expect(screen.queryByRole('heading')).toBeNull();
    });
  });

  describe('not offered', () => {
    it('draws nothing', () => {
      const { container } = renderTab({ status: 'none' });

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations with live readings', async () => {
      hold({ 'CT-01': entry({ fanSpeedRpm: 1420, motorTempC: 92 }) }, 400, {
        fanSpeedRpm: series([5 * MIN, 1200], [0, 1420]),
      });
      const { container } = renderTab();

      await expectNoAxeViolations(container);
    });

    it('has no axe violations with the last readings of a resolved incident', async () => {
      hold({ 'CT-01': entry({ fanSpeedRpm: 1420 }) });
      const { container } = renderTab(READY, incident(RESOLVED));

      await expectNoAxeViolations(container);
    });

    it('has no axe violations while loading', async () => {
      const { container } = renderTab({ status: 'loading' });

      await expectNoAxeViolations(container);
    });
  });
  // V3-23.3: 15 min | 1 h | Around the alarm.
  describe('the range switch', () => {
    const fetchMock = vi.fn<typeof fetch>();
    const iso = (t: number): string => new Date(t).toISOString();
    const at = (t: number) => formatClockTime(t);
    const RAISED_MS = RECEIVED_MS - 20 * MIN;
    const RAISED = incident({ reportedAt: iso(RAISED_MS) });
    const SAMPLES: AssetTelemetrySample[] = [
      { at: iso(RECEIVED_MS - 50 * MIN), values: { fanSpeedRpm: 900 } },
      { at: iso(RECEIVED_MS - 25 * MIN), values: { fanSpeedRpm: 1000, motorTempC: 70 } },
      { at: iso(RECEIVED_MS - 17 * MIN), values: { fanSpeedRpm: 1300, motorTempC: 88 } },
    ];
    const requested = (call = 0): URL =>
      new URL(String(fetchMock.mock.calls[call]![0]), 'http://console.test');
    const dotOf = (label: string) =>
      sparkOf(rowOf(label))?.querySelector('circle')?.getAttribute('cx');
    const choose = (name: string) => userEvent.click(screen.getByRole('radio', { name }));

    beforeEach(() => {
      fetchMock.mockReset().mockImplementation(async (input) => {
        const url = new URL(String(input), 'http://console.test');
        const body = {
          assetCode: 'CT-01',
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          bucketS: 5,
          samples: SAMPLES,
        };
        return new Response(JSON.stringify(body), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
      vi.mocked(renewSession).mockReset().mockResolvedValue(false);
      hold({ 'CT-01': entry({ fanSpeedRpm: 1420, motorTempC: 92 }) }, 400, {
        fanSpeedRpm: series([10 * MIN, 1000], [5 * MIN, 1200], [0, 1420]),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('offers 15 min, 1 h and Around the alarm, on 15 min', async () => {
      renderTab(READY, RAISED);
      await act(async () => {});

      expect(screen.getByRole('radiogroup', { name: 'Reading range' })).toBeInTheDocument();
      expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
        '15 min',
        '1 h',
        'Around the alarm',
      ]);
      expect(screen.getByRole('radio', { name: '15 min' })).toHaveAttribute('aria-checked', 'true');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('redraws every row from the last hour on 1 h', async () => {
      renderTab(READY, RAISED);

      await choose('1 h');

      // The newest bucket is 17 minutes old: 43 of the hour's 60 minutes across 96 units.
      await waitFor(() => expect(dotOf('Fan speed')).toBe('68.8'));
      expect(dotOf('Motor temperature')).toBe('68.8');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requested().searchParams.get('from')).toBe(iso(RECEIVED_MS - HOUR));
      expect(screen.getByRole('heading', { name: 'Readings, last hour' })).toBeInTheDocument();
      expect(screen.getByText(`${at(RECEIVED_MS - HOUR)}–${at(RECEIVED_MS)}`)).toBeInTheDocument();
      expect(screen.queryByText(/^Updated/)).toBeNull();
    });

    it('reads the 15 minutes around the raised time and marks it', async () => {
      renderTab(READY, RAISED);

      await choose('Around the alarm');

      await waitFor(() => expect(dotOf('Fan speed')).toBe('83.2'));
      expect(requested().searchParams.get('from')).toBe(iso(RAISED_MS - 10 * MIN));
      expect(requested().searchParams.get('to')).toBe(iso(RAISED_MS + 5 * MIN));
      expect(
        screen.getByRole('heading', { name: 'Readings around the alarm' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          `${at(RAISED_MS - 10 * MIN)}–${at(RAISED_MS + 5 * MIN)} · raised ${at(RAISED_MS)}`,
        ),
      ).toBeInTheDocument();
      // Raised 10 of the window's 15 minutes in.
      const marker = [...(sparkOf(rowOf('Fan speed'))?.querySelectorAll('line') ?? [])].find(
        (line) => line.getAttribute('x1') === line.getAttribute('x2'),
      );
      expect(marker).toHaveAttribute('x1', '64');
    });

    it('returns to the live rows on 15 min', async () => {
      renderTab(READY, RAISED);
      await choose('1 h');
      await waitFor(() => expect(dotOf('Fan speed')).toBe('68.8'));

      await choose('15 min');

      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      expect(dotOf('Fan speed')).toBe('96');
      expect(screen.getByText(/^Updated/)).toBeInTheDocument();
    });

    it('says the change in the eyebrow, through no live region', async () => {
      const { container } = renderTab(READY, RAISED);

      await choose('1 h');
      // Once the buckets are there: while they load, the range's one status line says so (V3-23.4).
      await waitFor(() => expect(dotOf('Fan speed')).toBe('68.8'));

      expect(screen.getByRole('heading', { name: 'Readings, last hour' })).toBeInTheDocument();
      expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    });

    describe('a resolved incident', () => {
      const RESOLVED_RAISED = incident({ ...RESOLVED, reportedAt: iso(RAISED_MS) });

      it('reads the alarm back, following the clock only while a past range is shown', async () => {
        renderTab(READY, RESOLVED_RAISED);
        expect(useServerNow).toHaveBeenLastCalledWith(false);
        expect(sparkOf(rowOf('Fan speed'))).toBeNull();

        await choose('Around the alarm');

        expect(useServerNow).toHaveBeenLastCalledWith(true);
        await waitFor(() => expect(dotOf('Fan speed')).toBe('83.2'));
        expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();

        await choose('15 min');

        expect(useServerNow).toHaveBeenLastCalledWith(false);
        expect(sparkOf(rowOf('Fan speed'))).toBeNull();
      });
    });

    it('starts on 15 min again for another incident (the sheet is keyed by its id)', async () => {
      const { client, rerender } = renderTab(READY, RAISED);
      await choose('Around the alarm');
      expect(screen.getByRole('radio', { name: 'Around the alarm' })).toHaveAttribute(
        'aria-checked',
        'true',
      );

      rerender(
        <QueryClientProvider client={client}>
          <IncidentTelemetry
            key="incident-2"
            incident={incident({ id: 'incident-2', reportedAt: iso(RAISED_MS) })}
            state={READY}
          />
        </QueryClientProvider>,
      );

      expect(screen.getByRole('radio', { name: '15 min' })).toHaveAttribute('aria-checked', 'true');
    });

    it('has no axe violations around the alarm', async () => {
      const { container } = renderTab(READY, RAISED);
      await choose('Around the alarm');
      await waitFor(() => expect(dotOf('Fan speed')).toBe('83.2'));

      await expectNoAxeViolations(container);
    });

    // V3-23.4 (frame 18): where Around the alarm's request stands; `AssetReadings.test.tsx` has every state's details
    // and `AssetTelemetry.test.tsx` the 429 being retried.
    describe('the range states', () => {
      const fail = (status: number) =>
        fetchMock.mockImplementation(
          async () =>
            new Response(JSON.stringify({ statusCode: status, message: 'Failed' }), { status }),
        );
      /** Every request answered at once with `samples`, over the range it asked for. */
      const serve = (samples: AssetTelemetrySample[]) =>
        fetchMock.mockImplementation(async (input) => {
          const url = new URL(String(input), 'http://console.test');
          const body = {
            assetCode: 'CT-01',
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to'),
            bucketS: 5,
            samples,
          };
          return new Response(JSON.stringify(body), { status: 200 });
        });
      const LIVE = '[role="status"], [role="alert"], [aria-live]';

      it('loads with a skeleton and one status line', async () => {
        fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
        const { container } = renderTab(READY, RAISED);

        await choose('Around the alarm');

        expect(screen.getByRole('status')).toHaveTextContent('Loading readings…');
        expect(container.querySelectorAll(LIVE)).toHaveLength(1);
        expect(rowOf('Fan speed')).toHaveTextContent('1,420');
        expect(sparkOf(rowOf('Fan speed'))).toBeNull();
        await expectNoAxeViolations(container);
      });

      it('says a failed range could not be loaded, and Retry reads the same window again', async () => {
        fail(500);
        const { container } = renderTab(READY, RAISED);
        await choose('Around the alarm');

        expect(await screen.findByText('Readings could not be loaded.')).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Around the alarm' })).toHaveAttribute(
          'aria-checked',
          'true',
        );
        await expectNoAxeViolations(container);

        serve(SAMPLES);
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

        await waitFor(() => expect(dotOf('Fan speed')).toBe('83.2'));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(requested(1).search).toBe(requested(0).search);
      });

      it('says the asset has no history on a 404, with no Retry', async () => {
        fail(404);
        const { container } = renderTab(READY, RAISED);
        await choose('Around the alarm');

        expect(await screen.findByText('No history for this asset.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
        await expectNoAxeViolations(container);
      });

      it('explains too many requests on a 429, with Retry', async () => {
        fail(429);
        const { container } = renderTab(READY, RAISED);
        await choose('Around the alarm');

        expect(await screen.findByText(TOO_MANY_REQUESTS)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        await expectNoAxeViolations(container);
      });

      it('says a range with no readings has none, with the live values kept', async () => {
        serve([]);
        const { container } = renderTab(READY, RAISED);
        await choose('Around the alarm');

        expect(await screen.findByText('No readings in this range.')).toBeInTheDocument();
        expect(sparkOf(rowOf('Fan speed'))).toBeNull();
        expect(rowOf('Fan speed')).toHaveTextContent('1,420');
        await expectNoAxeViolations(container);
      });
    });
  });
});
