import type {
  AssetDetail,
  AssetTelemetrySample,
  TelemetryPoint,
  TelemetryRule,
} from '@occ/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getAccessToken, renewSession } from '../../auth/session';
import { formatClockTime } from '../../lib/shared/time';
import {
  type AssetTelemetryState,
  initialTelemetryState,
} from '../../lib/telemetry/telemetryState';
import { seriesKey, type SeriesView } from '../../realtime/telemetryClient';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { expectNoAxeViolations, renderWithQueryClient, resetStore } from '../../test-utils';
import { AssetTelemetry } from './AssetTelemetry';

// The network is `fetch`, as in `queries.test.ts`: the real client, the cache and `useReadingSeries`.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();

const RECEIVED = '2026-10-16T08:00:00.000Z';
const RECEIVED_MS = Date.parse(RECEIVED);
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (t: number): string => new Date(t).toISOString();

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

const FAN = point();
const TEMP = point({
  key: 'motorTempC',
  label: 'Motor temperature',
  unit: '°C',
  min: -40,
  max: 150,
  headline: null,
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
  points: [FAN, TEMP],
  rules: [rule()],
};

const entry = (values: AssetTelemetryState['values']): AssetTelemetryState => ({
  online: true,
  receivedAt: RECEIVED,
  headline: values,
  values,
  keyReceivedAt: {},
});

/** A ring series: each pair is how long before `RECEIVED` the point was taken, and its value. */
const series = (...readings: [agoMs: number, value: number][]): SeriesView => ({
  t: Float64Array.from(readings.map(([ago]) => RECEIVED_MS - ago)),
  v: Float32Array.from(readings.map(([, value]) => value)),
});

/** The store with a live asset and its fan ring, on the API's clock 400 ms after the reading. */
function holdLive() {
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at: RECEIVED_MS + 400, mono: performance.now() },
          assets: { 'CT-01': entry({ fanSpeedRpm: 1420, motorTempC: 92 }) },
        },
        series: new Map([
          [seriesKey('CT-01', 'fanSpeedRpm'), series([10 * MIN, 1000], [5 * MIN, 1200], [0, 1420])],
        ]),
      },
    }),
  );
}

// The last hour from the database: both points, so every row redraws from it.
const SAMPLES: AssetTelemetrySample[] = [
  { at: iso(RECEIVED_MS - 50 * MIN), values: { fanSpeedRpm: 900, motorTempC: 70 } },
  { at: iso(RECEIVED_MS - 30 * MIN), values: { motorTempC: 80 } },
  { at: iso(RECEIVED_MS - 20 * MIN), values: { fanSpeedRpm: 1100 } },
];

/** The route answers with the range it was asked, as the API serves it. */
function serve() {
  fetchMock.mockImplementation(async (input) => {
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
}

const requested = (call = 0): URL =>
  new URL(String(fetchMock.mock.calls[call]![0]), 'http://console.test');

const rowOf = (label: string) => screen.getByText(label).closest('li') as HTMLElement;
// The sparkline's viewBox; the glyphs beside it are 24 × 24 and also `aria-hidden`.
const dotOf = (label: string) =>
  rowOf(label).querySelector('svg[viewBox="0 0 96 28"] circle')?.getAttribute('cx');

const renderTab = (key = 'CT-01') =>
  renderWithQueryClient(<AssetTelemetry key={key} detail={TOWER} />);

beforeEach(() => {
  resetStore(useTelemetryStore);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
  vi.mocked(renewSession).mockReset().mockResolvedValue(false);
  serve();
  holdLive();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AssetTelemetry', () => {
  describe('the range switch', () => {
    it('offers 15 min and 1 h, never Around the alarm', () => {
      renderTab();

      const group = screen.getByRole('radiogroup', { name: 'Reading range' });
      expect(group).toBeInTheDocument();
      expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
        '15 min',
        '1 h',
      ]);
      expect(screen.queryByRole('radio', { name: 'Around the alarm' })).toBeNull();
    });

    it('starts on 15 min: live rows, no caption and nothing sent', async () => {
      renderTab();
      await act(async () => {});

      expect(screen.getByRole('radio', { name: '15 min' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      expect(screen.getByText(/^Updated/)).toBeInTheDocument();
      // The live point at now ends the fan's line on the right edge.
      expect(dotOf('Fan speed')).toBe('96');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('1 h', () => {
    it("reads the asset's last hour once and redraws every row from it", async () => {
      renderTab();

      await userEvent.click(screen.getByRole('radio', { name: '1 h' }));

      await waitFor(() => expect(dotOf('Fan speed')).toBe('64'));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requested().pathname).toBe('/api/assets/CT-01/telemetry');
      expect(requested().searchParams.get('from')).toBe(iso(RECEIVED_MS - HOUR));
      expect(requested().searchParams.get('to')).toBe(RECEIVED);
      // 50 and 30 minutes ago: the temperature's newest bucket is half an hour in.
      expect(dotOf('Motor temperature')).toBe('48');
    });

    it('names the range in the eyebrow, says the window and hides the freshness line', async () => {
      renderTab();

      await userEvent.click(screen.getByRole('radio', { name: '1 h' }));

      expect(screen.getByRole('heading', { name: 'Readings, last hour' })).toBeInTheDocument();
      expect(
        screen.getByText(`${formatClockTime(RECEIVED_MS - HOUR)}–${formatClockTime(RECEIVED_MS)}`),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^Updated/)).toBeNull();
    });

    it('keeps the live value beside the past chart', async () => {
      renderTab();

      await userEvent.click(screen.getByRole('radio', { name: '1 h' }));
      await waitFor(() => expect(dotOf('Fan speed')).toBe('64'));

      expect(rowOf('Fan speed')).toHaveTextContent('1,420');
      expect(rowOf('Motor temperature')).toHaveTextContent('over its limit');
    });
  });

  describe('back to 15 min', () => {
    it('returns to the live rows and "Live readings" without asking again', async () => {
      renderTab();
      await userEvent.click(screen.getByRole('radio', { name: '1 h' }));
      await waitFor(() => expect(dotOf('Fan speed')).toBe('64'));

      await userEvent.click(screen.getByRole('radio', { name: '15 min' }));

      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      expect(dotOf('Fan speed')).toBe('96');
      expect(
        screen.queryByText(
          `${formatClockTime(RECEIVED_MS - HOUR)}–${formatClockTime(RECEIVED_MS)}`,
        ),
      ).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('starts on 15 min again for another asset (the sheet is keyed by its code)', async () => {
    const { client, rerender } = renderTab('CT-01');
    await userEvent.click(screen.getByRole('radio', { name: '1 h' }));
    expect(screen.getByRole('radio', { name: '1 h' })).toHaveAttribute('aria-checked', 'true');

    rerender(
      <QueryClientProvider client={client}>
        <AssetTelemetry key="CT-02" detail={TOWER} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('radio', { name: '15 min' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
  });

  it('has no axe violations on 1 h', async () => {
    const { container } = renderTab();
    await userEvent.click(screen.getByRole('radio', { name: '1 h' }));
    await waitFor(() => expect(dotOf('Fan speed')).toBe('64'));

    await expectNoAxeViolations(container);
  });
});
