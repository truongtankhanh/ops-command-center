import type { TelemetryPoint, TelemetryRule } from '@occ/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { InspectorRow } from '../../lib/assets/assetInspector';
import {
  type AssetTelemetryState,
  initialTelemetryState,
} from '../../lib/telemetry/telemetryState';
import type { ReadingSeries } from '../../lib/telemetry/useReadingSeries';
import { seriesKey, type SeriesView } from '../../realtime/telemetryClient';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { AssetReadings } from './AssetReadings';

const NOW = Date.parse('2026-10-15T08:00:00.000Z');
const MIN = 60_000;

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
  ...overrides,
});

const rule = (overrides: Partial<TelemetryRule> = {}): TelemetryRule => ({
  name: 'Motor over temperature',
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 5,
  severity: 'critical',
  incidentType: 'equipment_fault',
  ...overrides,
});

const row = (p: TelemetryPoint, r: TelemetryRule | null = null): InspectorRow => ({
  point: p,
  rule: r,
});

// Rows are stable objects, as `inspectorRows` gives them to a caller that memoises.
const FAN = row(point());
const TEMP = row(
  point({ key: 'motorTempC', label: 'Motor temperature', unit: '°C', headline: null }),
  rule(),
);

const entry = (receivedMs: number = NOW - 400): AssetTelemetryState => ({
  online: true,
  receivedAt: new Date(receivedMs).toISOString(),
  headline: {},
  values: { fanSpeedRpm: 1420, motorTempC: 92 },
  keyReceivedAt: {},
});

/** A ring series: each pair is how long before `NOW` the reading was taken, and its value. */
const series = (...readings: [agoMs: number, value: number][]): SeriesView => ({
  t: Float64Array.from(readings.map(([ago]) => NOW - ago)),
  v: Float32Array.from(readings.map(([, value]) => value)),
});

const hold = (byKey: Record<string, SeriesView>) =>
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: initialTelemetryState,
        series: new Map(
          Object.entries(byKey).map(([key, view]) => [seriesKey('CT-01', key), view]),
        ),
      },
    }),
  );

function renderReadings(props: Partial<ComponentProps<typeof AssetReadings>> = {}) {
  return render(
    <AssetReadings
      assetCode="CT-01"
      rows={{ main: [FAN, TEMP], more: [] }}
      entry={entry()}
      serverNow={NOW}
      stale={false}
      {...props}
    />,
  );
}

const rowOf = (label: string) => screen.getByText(label).closest('li') as HTMLElement;
// The sparkline's viewBox; the glyphs beside it are 24 × 24 and also `aria-hidden`.
const sparkOf = (item: HTMLElement) => item.querySelector('svg[viewBox="0 0 96 28"]');
const HINT = 'Charts stop at the last reading; the gap is the outage.';

// `ended` is the V3-09.6 addition: the readings of a watch that stopped on purpose (a resolved
// incident). Everything else here pins what the asset inspector has always shown.
describe('AssetReadings', () => {
  beforeEach(() => {
    resetStore(useTelemetryStore);
    hold({ fanSpeedRpm: series([10 * MIN, 1000], [5 * MIN, 1200]) });
  });

  describe('live', () => {
    it('is "Live readings" with a freshness line, a sparkline and undimmed rows', () => {
      renderReadings();

      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      expect(screen.getByText(/^Updated/)).toBeInTheDocument();
      expect(sparkOf(rowOf('Fan speed'))).not.toBeNull();
      expect(rowOf('Fan speed')).not.toHaveAttribute('data-stale');
      expect(screen.queryByText(HINT)).toBeNull();
    });
  });

  describe('stale', () => {
    it('is "Last readings", dims the rows and explains the gap', () => {
      renderReadings({ stale: true, entry: entry(NOW - 5 * MIN) });

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(screen.getByText(/ old$/)).toBeInTheDocument();
      expect(rowOf('Fan speed')).toHaveAttribute('data-stale', 'true');
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });
  });

  describe('ended', () => {
    it('is "Last readings" and dims the rows, as a stale row is', () => {
      renderReadings({ ended: true });

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Live readings' })).toBeNull();
      expect(rowOf('Fan speed')).toHaveAttribute('data-stale', 'true');
      expect(rowOf('Motor temperature')).toHaveAttribute('data-stale', 'true');
    });

    it('draws no freshness line: the age of an unfed reading is nothing to rely on', () => {
      renderReadings({ ended: true });

      expect(screen.queryByText(/^Updated/)).toBeNull();
      expect(screen.queryByText(/ old$/)).toBeNull();
    });

    it('draws no sparkline, even where a series is still held', () => {
      renderReadings({ ended: true });

      expect(sparkOf(rowOf('Fan speed'))).toBeNull();
      expect(sparkOf(rowOf('Motor temperature'))).toBeNull();
    });

    it('draws no outage hint, whether or not the asset is stale', () => {
      renderReadings({ ended: true, stale: true, entry: entry(NOW - 5 * MIN) });

      expect(screen.queryByText(HINT)).toBeNull();
      expect(screen.queryByText(/ old$/)).toBeNull();
    });

    it('still shows each value, and a reading past its rule in words', () => {
      renderReadings({ ended: true });

      expect(rowOf('Fan speed')).toHaveTextContent('1,420');
      const hot = rowOf('Motor temperature');
      expect(hot).toHaveTextContent('92');
      expect(hot).toHaveAttribute('data-severity', 'critical');
      expect(hot).toHaveTextContent('over its limit');
    });

    it('shows a dash for a point nothing has been received for', () => {
      renderReadings({
        ended: true,
        entry: { ...entry(), values: { fanSpeedRpm: 1420 } },
      });

      expect(rowOf('Motor temperature')).toHaveTextContent('—');
    });

    it('has no axe violations', async () => {
      const { container } = renderReadings({ ended: true });

      await expectNoAxeViolations(container);
    });
  });
  // V3-23.2: 1 h and Around the alarm draw the buckets the tab fetched (`useReadingSeries`), handed
  // in as `history`; the value, the rule line and the dimming stay the live ones.
  describe('a past range', () => {
    const HOUR = 60 * MIN;

    /** A column of the fetched buckets: each pair is how long before `NOW`, and the value. */
    const column = (...readings: [agoMs: number, value: number][]) => ({
      t: Float64Array.from(readings.map(([ago]) => NOW - ago)),
      v: Float32Array.from(readings.map(([, value]) => value)),
    });

    // The last hour, with the fan speed only: the motor temperature has no column in it.
    const pastHour = (overrides: Partial<ReadingSeries> = {}): ReadingSeries => ({
      window: { from: NOW - HOUR, to: NOW },
      byKey: new Map([['fanSpeedRpm', column([50 * MIN, 900], [20 * MIN, 1100])]]),
      markerAt: null,
      status: 'ready',
      error: null,
      refetch: () => undefined,
      ...overrides,
    });

    const verticals = (svg: Element | null) =>
      [...(svg?.querySelectorAll('line') ?? [])].filter(
        (line) => line.getAttribute('x1') === line.getAttribute('x2'),
      );

    it('draws the fetched buckets as they are, with no live point at now', () => {
      renderReadings({ range: '1h', history: pastHour() });

      const spark = sparkOf(rowOf('Fan speed'));
      expect(spark?.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
      // The newest bucket is 20 minutes old: 40 of the hour's 60 minutes across 96 units.
      expect(spark?.querySelector('circle')).toHaveAttribute('cx', '64');
      expect(verticals(spark)).toHaveLength(0);
    });

    it('draws the live ring for the same row on 15 min, ending at now', () => {
      renderReadings();

      expect(sparkOf(rowOf('Fan speed'))?.querySelector('circle')).toHaveAttribute('cx', '96');
    });

    it('draws nothing for a point with no readings in the range', () => {
      renderReadings({ range: '1h', history: pastHour() });

      // On 15 min the motor temperature's live value alone draws a dot.
      expect(sparkOf(rowOf('Motor temperature'))).toBeNull();
    });

    it('keeps the live value, its rule word and the undimmed row', () => {
      renderReadings({ range: '1h', history: pastHour() });

      expect(rowOf('Fan speed')).toHaveTextContent('1,420');
      expect(rowOf('Fan speed')).not.toHaveAttribute('data-stale');
      const hot = rowOf('Motor temperature');
      expect(hot).toHaveAttribute('data-severity', 'critical');
      expect(hot).toHaveTextContent('over its limit');
    });

    it('steps a boolean', () => {
      const door = row(
        point({ key: 'doorOpen', label: 'Door open', unit: null, kind: 'boolean', headline: null }),
      );
      renderReadings({
        rows: { main: [door], more: [] },
        range: '1h',
        history: pastHour({
          byKey: new Map([['doorOpen', column([50 * MIN, 0], [30 * MIN, 1], [10 * MIN, 0])]]),
        }),
      });

      const points = (
        sparkOf(rowOf('Door open'))?.querySelector('polyline')?.getAttribute('points') ?? ''
      )
        .split(' ')
        .map((pair) => pair.split(',').map(Number) as [number, number]);
      expect(points).toHaveLength(5);
      points.slice(1).forEach(([x, y], index) => {
        const [previousX, previousY] = points[index] ?? [NaN, NaN];
        expect(x === previousX || y === previousY).toBe(true);
      });
    });

    it('shows an enum as its value only', () => {
      const stage = row(
        point({
          key: 'stage',
          label: 'Stage',
          unit: null,
          kind: 'enum',
          enumValues: ['idle', 'cooling'],
          headline: null,
        }),
      );
      renderReadings({
        rows: { main: [stage], more: [] },
        entry: { ...entry(), values: { stage: 'cooling' } },
        range: '1h',
        history: pastHour(),
      });

      expect(sparkOf(rowOf('Stage'))).toBeNull();
      expect(rowOf('Stage')).toHaveTextContent('Cooling');
    });

    it('marks the raised time around the alarm, over its 15-minute window only', () => {
      renderReadings({
        range: 'alarm',
        history: pastHour({
          window: { from: NOW - 30 * MIN, to: NOW - 15 * MIN },
          byKey: new Map([
            ['fanSpeedRpm', column([45 * MIN, 800], [28 * MIN, 950], [17 * MIN, 1300])],
          ]),
          markerAt: NOW - 20 * MIN,
        }),
      });

      const spark = sparkOf(rowOf('Fan speed'));
      // Raised 10 of the window's 15 minutes in.
      const [marker] = verticals(spark);
      expect(marker).toHaveAttribute('x1', '64');
      // The bucket from 45 minutes ago is outside the window and is not drawn.
      expect(spark?.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
      expect(spark?.querySelector('circle')).toHaveAttribute('cx', '83.2');
    });

    it('still draws a past range for a watch that has ended', () => {
      renderReadings({ ended: true, range: '1h', history: pastHour() });

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(rowOf('Fan speed')).toHaveAttribute('data-stale', 'true');
      expect(sparkOf(rowOf('Fan speed'))).not.toBeNull();
    });

    it('draws no chart before the window is known', () => {
      renderReadings({
        range: '1h',
        history: pastHour({ window: null, byKey: new Map(), status: 'loading' }),
      });

      expect(sparkOf(rowOf('Fan speed'))).toBeNull();
    });

    it('ignores `history` on 15 min: the rows are what they were', () => {
      const plain = renderReadings().container.innerHTML;
      cleanup();

      const withHistory = renderReadings({
        history: pastHour({ markerAt: NOW - 20 * MIN }),
      }).container.innerHTML;

      expect(withHistory).toBe(plain);
    });

    // V3-23.3: the eyebrow names the range drawn, and a past window has no freshness.
    describe('the eyebrow', () => {
      it.each([
        ['1h', 'Readings, last hour'],
        ['alarm', 'Readings around the alarm'],
      ] as const)('names %s', (range, heading) => {
        renderReadings({ range, history: pastHour() });

        expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Live readings' })).toBeNull();
      });

      it('stays "Live readings" on 15 min, with its freshness line', () => {
        renderReadings({ history: pastHour() });

        expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
        expect(screen.getByText(/^Updated/)).toBeInTheDocument();
      });

      it.each(['1h', 'alarm'] as const)('draws no freshness line on %s', (range) => {
        renderReadings({ range, history: pastHour() });

        expect(screen.queryByText(/^Updated/)).toBeNull();
        expect(screen.queryByText(/ old$/)).toBeNull();
      });

      it('is "Last readings" for a stale asset, whatever the range', () => {
        renderReadings({
          range: '1h',
          history: pastHour(),
          stale: true,
          entry: entry(NOW - 5 * MIN),
        });

        expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
        expect(screen.queryByText(/ old$/)).toBeNull();
      });

      it('is "Last readings" for an ended watch, whatever the range', () => {
        renderReadings({ range: 'alarm', history: pastHour(), ended: true });

        expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      });

      it('is a heading, not a live region', () => {
        const { container } = renderReadings({ range: '1h', history: pastHour() });

        expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
      });
    });

    it('has no axe violations around the alarm', async () => {
      const { container } = renderReadings({
        range: 'alarm',
        history: pastHour({ markerAt: NOW - 20 * MIN }),
      });

      await expectNoAxeViolations(container);
    });
  });
});
