import type { AssetDetail, Incident, TelemetryPoint, TelemetryRule } from '@occ/contracts';
import { act, render, screen } from '@testing-library/react';
import type { TelemetryTabState } from '../../lib/incidents/useIncidentTelemetry';
import {
  type AssetTelemetryState,
  initialTelemetryState,
} from '../../lib/telemetry/telemetryState';
import { seriesKey, type SeriesView } from '../../realtime/telemetryClient';
import type * as TelemetryStore from '../../realtime/telemetryStore';
import { useServerNow, useTelemetryStore } from '../../realtime/telemetryStore';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { IncidentTelemetry } from './IncidentTelemetry';

// Spies on the clock: an ended watch must not follow it, an open one must.
vi.mock('../../realtime/telemetryStore', async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryStore>();
  return { ...actual, useServerNow: vi.fn(actual.useServerNow) };
});

const RECEIVED = '2026-10-16T08:00:00.000Z';
const RECEIVED_MS = Date.parse(RECEIVED);
const MIN = 60_000;

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

const renderTab = (state: TelemetryTabState = READY, raised: Incident = incident()) =>
  render(<IncidentTelemetry incident={raised} state={state} />);

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
});
