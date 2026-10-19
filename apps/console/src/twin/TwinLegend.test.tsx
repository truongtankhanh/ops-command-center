import type { Asset, TelemetryPoint } from '@occ/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { MapLegend } from '../components/MapLegend';
import { initialTelemetryState } from '../lib/telemetryState';
import { useTelemetryStore } from '../realtime/telemetryStore';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../test-utils';
import { TwinLegend } from './TwinLegend';

const KEY = 'occ.console.mapLegendOpen';

const entries = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

const STALE_ENTRY = 'No data — last known state, not live';

const point = (key: string, expectedIntervalS: number): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS,
  headline: 1,
});

/** An asset whose reading is stale after the 5 s floor. */
const asset = (code: string): Asset => ({
  id: `asset-${code}`,
  code,
  name: code,
  class: {
    id: 'class-ups',
    code: 'ups',
    name: 'UPS',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [point('loadPct', 1)],
});

/** What the console holds of an asset: received `ageMs` ago on the server's clock, which is the test's. */
const entry = (ageMs: number, online = true) => ({
  online,
  receivedAt: new Date(Date.now() - ageMs).toISOString(),
  headline: {},
  values: {},
  keyReceivedAt: {},
});

/** The legend inside a query provider, with the catalogue seeded and the telemetry the test sets. */
function renderLegend(
  assets: Asset[] = [],
  overview: Record<string, ReturnType<typeof entry>> = {},
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, assets);
  act(() => {
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at: Date.now(), mono: performance.now() },
          assets: overview,
        },
        series: new Map(),
      },
    });
  });
  return renderWithQueryClient(<TwinLegend />, client);
}

describe('TwinLegend', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => resetStore(useTelemetryStore));
  });

  it('is open by default, with the legend toggle expanded', () => {
    renderLegend();

    expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list')).toBeVisible();
  });

  it('lists the open and handled incidents, the camera and the asset, as frame 01 does', () => {
    renderLegend();

    expect(entries()).toEqual(['Open', 'Being handled', 'Camera', 'Asset — hover for readings']);
  });

  // A swatch is a shape and the words say what it is: neither is read twice nor needed alone.
  it('hides the swatches from assistive tech', () => {
    renderLegend();

    const swatches = document.querySelectorAll('li > span');
    expect(swatches).toHaveLength(3);
    for (const swatch of swatches) expect(swatch).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes and opens the list, and says so on the toggle', async () => {
    const user = userEvent.setup();
    renderLegend();

    await user.click(screen.getByRole('button', { name: 'Legend' }));

    expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('list')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Legend' }));

    expect(screen.getByRole('list')).toBeVisible();
  });

  it('remembers it in this browser, in the key the 2D legend uses', async () => {
    const user = userEvent.setup();
    renderLegend();

    await user.click(screen.getByRole('button', { name: 'Legend' }));

    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('shares the preference with the 2D legend: closed there, closed here', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MapLegend />);
    await user.click(screen.getByRole('button', { name: 'Legend' }));
    unmount();

    renderLegend();

    expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens and works when storage is blocked', async () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const user = userEvent.setup();
    renderLegend();

    expect(screen.getByRole('list')).toBeVisible();
    await expect(
      user.click(screen.getByRole('button', { name: 'Legend' })),
    ).resolves.toBeUndefined();
  });

  it('has no accessibility violations, open and closed', async () => {
    const user = userEvent.setup();
    renderLegend();
    await expectNoAxeViolations();

    await user.click(screen.getByRole('button', { name: 'Legend' }));
    await expectNoAxeViolations();
  });

  describe('the stale entry (V2-14.9)', () => {
    it('is not listed while every asset reports live', () => {
      renderLegend([asset('UPS-01'), asset('UPS-02')], {
        'UPS-01': entry(1_000),
        'UPS-02': entry(2_000),
      });

      expect(screen.queryByText(STALE_ENTRY)).not.toBeInTheDocument();
    });

    it('is listed for an asset with no data', () => {
      renderLegend([asset('UPS-01')], {});

      expect(screen.getByText(STALE_ENTRY)).toBeInTheDocument();
    });

    it('is listed for an offline asset', () => {
      renderLegend([asset('UPS-01')], { 'UPS-01': entry(1_000, false) });

      expect(screen.getByText(STALE_ENTRY)).toBeInTheDocument();
    });

    it('is listed for a stale asset, and not before its threshold', () => {
      const { unmount } = renderLegend([asset('UPS-01')], { 'UPS-01': entry(4_000) });
      expect(screen.queryByText(STALE_ENTRY)).not.toBeInTheDocument();
      unmount();

      renderLegend([asset('UPS-01')], { 'UPS-01': entry(60_000) });
      expect(screen.getByText(STALE_ENTRY)).toBeInTheDocument();
    });

    it('is listed after the four entries of frame 01', () => {
      renderLegend([asset('UPS-01')], {});

      expect(entries()).toEqual([
        'Open',
        'Being handled',
        'Camera',
        'Asset — hover for readings',
        STALE_ENTRY,
      ]);
    });

    it('appears when an asset goes stale and goes when it reports again', () => {
      renderLegend([asset('UPS-01')], { 'UPS-01': entry(1_000) });
      expect(screen.queryByText(STALE_ENTRY)).not.toBeInTheDocument();

      act(() => {
        useTelemetryStore.setState({
          view: {
            state: {
              ...initialTelemetryState,
              serverClock: { at: Date.now(), mono: performance.now() },
              assets: {},
            },
            series: new Map(),
          },
        });
      });
      expect(screen.getByText(STALE_ENTRY)).toBeInTheDocument();

      act(() => {
        useTelemetryStore.setState({
          view: {
            state: {
              ...initialTelemetryState,
              serverClock: { at: Date.now(), mono: performance.now() },
              assets: { 'UPS-01': entry(500) },
            },
            series: new Map(),
          },
        });
      });
      expect(screen.queryByText(STALE_ENTRY)).not.toBeInTheDocument();
    });

    it('hides its swatch from assistive tech, like the others', () => {
      renderLegend([asset('UPS-01')], {});

      const swatches = document.querySelectorAll('li > span');
      expect(swatches).toHaveLength(4);
      for (const swatch of swatches) expect(swatch).toHaveAttribute('aria-hidden', 'true');
    });

    it('has no accessibility violations with the entry shown', async () => {
      renderLegend([asset('UPS-01')], {});

      await expectNoAxeViolations();
    });
  });
});
