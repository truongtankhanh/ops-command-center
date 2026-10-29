import type { TelemetryPoint, TelemetryRule } from '@occ/contracts';
import { act, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { InspectorRow } from '../../lib/assets/assetInspector';
import {
  type AssetTelemetryState,
  initialTelemetryState,
} from '../../lib/telemetry/telemetryState';
import { seriesKey, type SeriesView } from '../../realtime/telemetryClient';
import type * as TelemetryStore from '../../realtime/telemetryStore';
import { useAssetSeries, useTelemetryStore } from '../../realtime/telemetryStore';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { LiveTiles } from './LiveTiles';

// Counts how often a tile renders: each render of a tile reads its own key's series once, so the
// calls for a key are that tile's renders. (A `Profiler` would also fire for the parent's own render.)
vi.mock('../../realtime/telemetryStore', async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryStore>();
  return { ...actual, useAssetSeries: vi.fn(actual.useAssetSeries) };
});

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
const INTERLOCK = row(
  point({ key: 'interlock', label: 'Interlock', kind: 'boolean', unit: null, headline: null }),
);
const MODE = row(
  point({
    key: 'mode',
    label: 'Mode',
    kind: 'enum',
    unit: null,
    enumValues: ['auto', 'manual'],
    headline: null,
  }),
);
const MYSTERY = row(
  point({
    key: 'mystery',
    label: 'Mystery',
    kind: 'vector' as TelemetryPoint['kind'],
    unit: null,
    headline: null,
  }),
);

const entry = (
  values: AssetTelemetryState['values'] = {},
  receivedMs: number = NOW - 400,
): AssetTelemetryState => ({
  online: true,
  receivedAt: new Date(receivedMs).toISOString(),
  headline: {},
  values,
  keyReceivedAt: {},
});

/** A ring series: each pair is how long before `NOW` the reading was taken, and its value. */
const series = (...readings: [agoMs: number, value: number][]): SeriesView => ({
  t: Float64Array.from(readings.map(([ago]) => NOW - ago)),
  v: Float32Array.from(readings.map(([, value]) => value)),
});

const hold = (byKey: Record<string, SeriesView> = {}) =>
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

function renderTiles(props: Partial<ComponentProps<typeof LiveTiles>> = {}) {
  return render(
    <LiveTiles
      assetCode="CT-01"
      rows={[FAN]}
      entry={entry({ fanSpeedRpm: 1420 })}
      serverNow={NOW}
      stale={false}
      {...props}
    />,
  );
}

/** The tile that carries a label. */
const tileOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;
// The sparkline's viewBox; the glyphs beside it are 24 × 24 and also `aria-hidden`.
const sparkOf = (tile: HTMLElement) => tile.querySelector('svg[viewBox="0 0 96 28"]');
const deltaOf = (tile: HTMLElement) => tile.querySelector<HTMLElement>('[data-direction]');

describe('LiveTiles', () => {
  beforeEach(() => {
    resetStore(useTelemetryStore);
    vi.mocked(useAssetSeries).mockClear();
  });

  describe('the section', () => {
    it('is a named section with a heading, one list item per point', () => {
      renderTiles({
        rows: [FAN, TEMP],
        entry: entry({ fanSpeedRpm: 1420, motorTempC: 71 }),
      });

      expect(screen.getByRole('heading', { name: 'Live data' })).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('draws nothing for no points', () => {
      const { container } = renderTiles({ rows: [] });

      expect(container).toBeEmptyDOMElement();
    });

    it('says how long ago, outside any live region', () => {
      renderTiles();

      const text = screen.getByText(/^Updated \d(\.\d)? s ago$/);
      expect(text.closest('[role="status"], [aria-live]')).toBeNull();
    });

    it('says nothing of freshness before anything was received', () => {
      renderTiles({ entry: undefined });

      expect(screen.queryByText(/ago$|old$/)).toBeNull();
    });
  });

  describe('the value', () => {
    it('writes a number with its unit', () => {
      renderTiles();

      expect(tileOf('Fan speed')).toHaveTextContent('1,420 rpm');
    });

    it('takes the headline copy when the asset has no later frame for the key', () => {
      renderTiles({ entry: { ...entry(), headline: { fanSpeedRpm: 900 } } });

      expect(tileOf('Fan speed')).toHaveTextContent('900 rpm');
    });

    it('reads "—" for a point with no reading, and draws no chart', () => {
      renderTiles({ entry: entry() });

      const tile = tileOf('Fan speed');
      // The value and, with nothing to compare, the change.
      expect(within(tile).getAllByText('—')).toHaveLength(2);
      expect(sparkOf(tile)).toBeNull();
    });

    it('words a boolean and an enum, and shows a kind it does not know as it came', () => {
      renderTiles({
        rows: [INTERLOCK, MODE, MYSTERY],
        entry: entry({ interlock: true, mode: 'auto', mystery: 'x-ray' }),
      });

      expect(tileOf('Interlock')).toHaveTextContent('Yes');
      expect(tileOf('Mode')).toHaveTextContent('Auto');
      expect(tileOf('Mystery')).toHaveTextContent('x-ray');
    });
  });

  describe('the delta', () => {
    it('rises: an arrow and a signed number over the window, and the same in words', () => {
      hold({ fanSpeedRpm: series([14 * MIN, 1400], [MIN, 1410]) });
      renderTiles();

      const delta = deltaOf(tileOf('Fan speed'));
      expect(delta).toHaveAttribute('data-direction', 'up');
      expect(delta?.querySelector('svg')).not.toBeNull();
      expect(delta).toHaveTextContent('+20 / 15 min');
      expect(delta).toHaveTextContent('Up 20 rpm over the last 15 minutes');
    });

    it('falls, with a real minus', () => {
      hold({ fanSpeedRpm: series([14 * MIN, 1500], [MIN, 1450]) });
      renderTiles();

      const delta = deltaOf(tileOf('Fan speed'));
      expect(delta).toHaveAttribute('data-direction', 'down');
      expect(delta).toHaveTextContent('−80 / 15 min');
      expect(delta).toHaveTextContent('Down 80 rpm over the last 15 minutes');
    });

    it('is steady when nothing moved, with a dash rather than an arrow', () => {
      hold({ fanSpeedRpm: series([14 * MIN, 1420], [MIN, 1420]) });
      renderTiles();

      const delta = deltaOf(tileOf('Fan speed'));
      expect(delta).toHaveAttribute('data-direction', 'flat');
      expect(delta).toHaveTextContent('Steady');
      expect(delta).toHaveTextContent('Steady over the last 15 minutes');
    });

    it('reads "—" with no history, and says nothing is shown', () => {
      renderTiles();

      const delta = deltaOf(tileOf('Fan speed'));
      expect(delta).toHaveAttribute('data-direction', 'none');
      expect(delta).toHaveTextContent('—');
      expect(delta).toHaveTextContent('No change shown');
      expect(delta?.querySelector('svg')).toBeNull();
    });

    it('reads "—" for a boolean and an enum, which have no change to speak of', () => {
      hold({ interlock: series([14 * MIN, 0], [MIN, 0]) });
      renderTiles({
        rows: [INTERLOCK, MODE],
        entry: entry({ interlock: true, mode: 'auto' }),
      });

      expect(deltaOf(tileOf('Interlock'))).toHaveAttribute('data-direction', 'none');
      expect(deltaOf(tileOf('Mode'))).toHaveAttribute('data-direction', 'none');
    });

    it('reads "—" before the clock is known', () => {
      hold({ fanSpeedRpm: series([14 * MIN, 1400], [MIN, 1410]) });
      renderTiles({ serverNow: null });

      expect(deltaOf(tileOf('Fan speed'))).toHaveAttribute('data-direction', 'none');
    });
  });

  describe('the chart', () => {
    it('is a decorative sparkline for a number, ending at "now" while live', () => {
      hold({ fanSpeedRpm: series([14 * MIN, 1400], [MIN, 1410]) });
      renderTiles();

      const spark = sparkOf(tileOf('Fan speed'));
      expect(spark).not.toBeNull();
      expect(spark).not.toHaveAttribute('data-stale');
      expect(spark?.querySelector('polyline')).toBeInTheDocument();
      expect(spark?.querySelector('circle')).toHaveAttribute('cx', '96');
    });

    it('draws one for a boolean and none for an enum or a kind it does not know', () => {
      renderTiles({
        rows: [INTERLOCK, MODE, MYSTERY],
        entry: entry({ interlock: true, mode: 'auto', mystery: 'x-ray' }),
      });

      expect(sparkOf(tileOf('Interlock'))).not.toBeNull();
      expect(sparkOf(tileOf('Mode'))).toBeNull();
      expect(sparkOf(tileOf('Mystery'))).toBeNull();
    });

    it('draws the rule limit for a number with a rule, and none without or for a boolean', () => {
      renderTiles({
        rows: [FAN, TEMP],
        entry: entry({ fanSpeedRpm: 1420, motorTempC: 71 }),
      });

      expect(sparkOf(tileOf('Fan speed'))?.querySelector('line')).toBeNull();
      expect(sparkOf(tileOf('Motor temperature'))?.querySelector('line')).toBeInTheDocument();
    });
  });

  describe('past its rule', () => {
    it('takes the rule severity and says so in words', () => {
      renderTiles({ rows: [TEMP], entry: entry({ motorTempC: 92 }) });

      const tile = tileOf('Motor temperature');
      expect(tile).toHaveAttribute('data-severity', 'critical');
      expect(tile).toHaveTextContent('92 °C, over its limit');
      expect(sparkOf(tile)).toHaveAttribute('data-severity', 'critical');
    });

    it('is plain within its limit', () => {
      renderTiles({ rows: [TEMP], entry: entry({ motorTempC: 71 }) });

      const tile = tileOf('Motor temperature');
      expect(tile).not.toHaveAttribute('data-severity');
      expect(tile).not.toHaveTextContent('over its limit');
    });
  });

  describe('stale', () => {
    const staleSeries = () => hold({ fanSpeedRpm: series([14 * MIN, 1400], [72_000, 1420]) });
    const renderStale = (props: Partial<ComponentProps<typeof LiveTiles>> = {}) =>
      renderTiles({ stale: true, entry: entry({ fanSpeedRpm: 1420 }, NOW - 72_000), ...props });

    it('turns the heading, the age and the hint to the last readings', () => {
      staleSeries();
      renderStale();

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(screen.getByText('1 min 12 s old')).toBeInTheDocument();
      expect(
        screen.getByText('Charts stop at the last reading; the gap is the outage.'),
      ).toBeInTheDocument();
    });

    it('is live without the hint', () => {
      renderTiles();

      expect(screen.queryByText(/Charts stop at the last reading/)).toBeNull();
    });

    it('dims the tile and reports no change, even over a series that moved', () => {
      staleSeries();
      renderStale();

      const tile = tileOf('Fan speed');
      expect(tile).toHaveAttribute('data-stale', 'true');
      expect(deltaOf(tile)).toHaveAttribute('data-direction', 'none');
      expect(tile).toHaveTextContent('1,420 rpm');
    });

    it('stops the chart at the last reading', () => {
      staleSeries();
      renderStale();

      const spark = sparkOf(tileOf('Fan speed'));
      expect(spark).toHaveAttribute('data-stale');
      // Nothing is added at "now": the dot is the ring's last point, short of the right edge.
      expect(Number(spark?.querySelector('circle')?.getAttribute('cx'))).toBeLessThan(96);
    });

    it('keeps the over-limit words on a stale tile that was past its rule', () => {
      renderStale({ rows: [TEMP], entry: entry({ motorTempC: 92 }, NOW - 72_000) });

      const tile = tileOf('Motor temperature');
      expect(tile).toHaveAttribute('data-stale', 'true');
      expect(tile).toHaveAttribute('data-severity', 'critical');
      expect(tile).toHaveTextContent('over its limit');
    });
  });

  // AC 4: a tile re-renders for its own key and the clock only.
  describe('re-rendering', () => {
    const renders = (key: string) =>
      vi.mocked(useAssetSeries).mock.calls.filter(([, read]) => read === key).length;
    const both = (values: AssetTelemetryState['values'], serverNow: number = NOW) => (
      <LiveTiles
        assetCode="CT-01"
        rows={[FAN, TEMP]}
        entry={entry(values)}
        serverNow={serverNow}
        stale={false}
      />
    );

    it('does not re-render for the reading of another key', () => {
      const { rerender } = render(both({ fanSpeedRpm: 1420, motorTempC: 71 }));
      const before = { fan: renders('fanSpeedRpm'), temp: renders('motorTempC') };

      rerender(both({ fanSpeedRpm: 1420, motorTempC: 72 }));

      expect(renders('fanSpeedRpm')).toBe(before.fan);
      expect(renders('motorTempC')).toBe(before.temp + 1);
      expect(tileOf('Motor temperature')).toHaveTextContent('72 °C');
    });

    it('re-renders for its own reading', () => {
      const { rerender } = render(both({ fanSpeedRpm: 1420, motorTempC: 71 }));
      const before = { fan: renders('fanSpeedRpm'), temp: renders('motorTempC') };

      rerender(both({ fanSpeedRpm: 1500, motorTempC: 71 }));

      expect(renders('fanSpeedRpm')).toBe(before.fan + 1);
      expect(renders('motorTempC')).toBe(before.temp);
    });

    it('follows the clock, every tile', () => {
      const { rerender } = render(both({ fanSpeedRpm: 1420, motorTempC: 71 }));
      const before = { fan: renders('fanSpeedRpm'), temp: renders('motorTempC') };

      rerender(both({ fanSpeedRpm: 1420, motorTempC: 71 }, NOW + 1000));

      expect(renders('fanSpeedRpm')).toBe(before.fan + 1);
      expect(renders('motorTempC')).toBe(before.temp + 1);
    });

    it('re-renders for its own series and not for the series of another key', () => {
      render(both({ fanSpeedRpm: 1420, motorTempC: 71 }));
      const before = { fan: renders('fanSpeedRpm'), temp: renders('motorTempC') };

      hold({ fanSpeedRpm: series([14 * MIN, 1400], [MIN, 1410]) });

      expect(renders('fanSpeedRpm')).toBe(before.fan + 1);
      expect(renders('motorTempC')).toBe(before.temp);
    });
  });

  describe('accessibility', () => {
    const everything = {
      rows: [FAN, TEMP, INTERLOCK, MODE],
      entry: entry({ fanSpeedRpm: 1420, motorTempC: 92, interlock: true, mode: 'auto' }),
    };

    it('has no axe violations, live', async () => {
      hold({
        fanSpeedRpm: series([14 * MIN, 1400], [MIN, 1410]),
        motorTempC: series([14 * MIN, 70], [MIN, 80]),
      });
      const { container } = renderTiles(everything);

      await expectNoAxeViolations(container);
    });

    it('has no axe violations, stale', async () => {
      hold({ fanSpeedRpm: series([14 * MIN, 1400], [72_000, 1420]) });
      const { container } = renderTiles({
        ...everything,
        stale: true,
        entry: entry({ fanSpeedRpm: 1420, motorTempC: 92 }, NOW - 72_000),
      });

      await expectNoAxeViolations(container);
    });
  });
});
