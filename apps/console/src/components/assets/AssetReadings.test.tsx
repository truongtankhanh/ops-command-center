import type { TelemetryPoint, TelemetryRule } from '@occ/contracts';
import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { InspectorRow } from '../../lib/assets/assetInspector';
import {
  type AssetTelemetryState,
  initialTelemetryState,
} from '../../lib/telemetry/telemetryState';
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
});
