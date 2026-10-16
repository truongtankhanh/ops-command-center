import type { Asset, Incident, TelemetryPoint } from '@occ/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import type { AssetState } from '../lib/assets';
import { type AssetTelemetryState, initialTelemetryState } from '../lib/telemetryState';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { AssetRow } from './AssetRow';

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

const asset = (overrides: Partial<Asset> = {}): Asset => ({
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
  headline: [point()],
  ...overrides,
});

const incident: Incident = {
  id: 'inc-1',
  code: 'INC-000108',
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: 'Fan fault',
  description: null,
  zoneId: 'zone-dc',
  position: [0, 0],
  source: 'telemetry',
  assetId: 'asset-ct-01',
  reportedAt: '2026-10-15T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

const entry = (values: AssetTelemetryState['values'] = {}): AssetTelemetryState => ({
  online: true,
  receivedAt: '2026-10-15T08:00:00.000Z',
  headline: {},
  values,
  keyReceivedAt: {},
});

/** The telemetry store holds `assets` (by code); nothing else of the view matters to a row. */
const holdAssets = (assets: Record<string, AssetTelemetryState>) =>
  act(() =>
    useTelemetryStore.setState({
      view: { state: { ...initialTelemetryState, assets }, series: new Map() },
    }),
  );

const register = vi.fn<(key: string, element: HTMLButtonElement | null) => void>();
const onFocusItem = vi.fn<(key: string) => void>();

function Row({
  asset: item = asset(),
  state = 'running',
  incident: raised,
  ageMs = null,
  tabIndex = 0,
}: {
  asset?: Asset;
  state?: AssetState;
  incident?: Incident;
  ageMs?: number | null;
  tabIndex?: 0 | -1;
}) {
  return (
    <AssetRow
      asset={item}
      state={state}
      incident={raised}
      ageMs={ageMs}
      itemKey={`asset:${item.code}`}
      tabIndex={tabIndex}
      register={register}
      onFocusItem={onFocusItem}
    />
  );
}

const row = () => screen.getByRole('button');

describe('AssetRow', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useTelemetryStore);
    register.mockReset();
    onFocusItem.mockReset();
  });

  describe('the state', () => {
    it('says running, with the first headline reading', () => {
      holdAssets({ 'CT-01': entry({ fanSpeedRpm: 1420 }) });

      render(<Row state="running" />);

      expect(within(row()).getByText('Cooling tower 1')).toBeInTheDocument();
      expect(within(row()).getByText('1,420 rpm')).toBeInTheDocument();
      expect(within(row()).getByText('Running')).toBeInTheDocument();
      expect(within(row()).getByText('CT-01')).toBeInTheDocument();
    });

    it('says standby with the reading it holds', () => {
      holdAssets({ 'CT-01': entry({ fanSpeedRpm: 0 }) });

      render(<Row state="standby" />);

      expect(within(row()).getByText('Standby')).toBeInTheDocument();
      expect(within(row()).getByText('0 rpm')).toBeInTheDocument();
    });

    it('says no data with its age, and dims the last value', () => {
      holdAssets({ 'CT-01': entry({ fanSpeedRpm: 1420 }) });

      render(<Row state="nodata" ageMs={60_000} />);

      expect(within(row()).getByText('No data · 1 min')).toBeInTheDocument();
      expect(within(row()).getByText('1,420 rpm')).toHaveAttribute('data-stale', 'true');
    });

    it('says no data with no age and no value for an asset it has nothing of', () => {
      render(<Row state="nodata" ageMs={null} />);

      expect(within(row()).getByText('No data')).toBeInTheDocument();
      expect(within(row()).getByText('—')).toBeInTheDocument();
    });

    it('says offline with its age', () => {
      holdAssets({ 'CT-01': entry({ fanSpeedRpm: 1420 }) });

      render(<Row state="offline" ageMs={3 * 60_000} />);

      expect(within(row()).getByText('Offline · 3 min')).toBeInTheDocument();
      expect(within(row()).getByText('1,420 rpm')).toHaveAttribute('data-stale', 'true');
    });

    it('does not dim the value of a live asset', () => {
      holdAssets({ 'CT-01': entry({ fanSpeedRpm: 1420 }) });

      render(<Row state="running" />);

      expect(within(row()).getByText('1,420 rpm')).toHaveAttribute('data-stale', 'false');
    });

    it('says a fault with the incident code and its severity, in words as well as the tint', () => {
      holdAssets({ 'CT-01': entry({ fanSpeedRpm: 1420 }) });

      render(<Row state="fault" incident={incident} />);

      expect(within(row()).getByText(/Fault · INC-000108/)).toBeInTheDocument();
      expect(within(row()).getByText(/High severity/)).toBeInTheDocument();
      expect(row()).toHaveAttribute('data-severity', 'high');
    });

    // A fault is never hidden by a stale reading, and its values are still drawn as stale (V2-09.1).
    it('reads Fault and dims the value of a fault whose reading is stale', () => {
      holdAssets({ 'CT-01': entry({ fanSpeedRpm: 1420 }) });

      render(<Row state="fault" incident={incident} ageMs={4 * 60_000} />);

      expect(within(row()).getByText(/Fault · INC-000108/)).toBeInTheDocument();
      expect(within(row()).getByText('1,420 rpm')).toHaveAttribute('data-stale', 'true');
    });

    it('does not dim the value of a fault whose reading is live', () => {
      holdAssets({ 'CT-01': entry({ fanSpeedRpm: 1420 }) });

      render(<Row state="fault" incident={incident} ageMs={null} />);

      expect(within(row()).getByText('1,420 rpm')).toHaveAttribute('data-stale', 'false');
    });

    it('draws no state word for an asset it cannot judge', () => {
      render(<Row state="unknown" />);

      expect(within(row()).queryByText(/Running|Standby|No data|Offline|Fault/)).toBeNull();
      expect(row()).toHaveAttribute('data-state', 'unknown');
    });
  });

  describe('the value', () => {
    it('writes a leak sensor by its word', () => {
      const sensor = asset({
        id: 'lks',
        code: 'LKS-B3',
        name: 'Leak sensor B3',
        headline: [point({ key: 'leakDetected', kind: 'boolean', unit: null })],
      });
      holdAssets({ 'LKS-B3': entry({ leakDetected: true }) });

      render(<Row asset={sensor} state="running" />);

      expect(within(row()).getByText('Wet')).toBeInTheDocument();
    });

    it('draws a dash for an asset with no headline point', () => {
      render(<Row asset={asset({ headline: [] })} state="running" />);

      expect(within(row()).getByText('—')).toBeInTheDocument();
    });
  });

  describe('the class', () => {
    it('names no class for a class this build knows', () => {
      render(<Row />);

      expect(within(row()).queryByText('cooling_tower')).toBeNull();
    });

    it('names the raw class and draws another glyph for one it does not know', () => {
      const mystery = asset({
        class: { ...asset().class, code: 'mystery_pump', name: 'Mystery pump' },
      });
      const known = asset({ id: 'asset-ct-02', code: 'CT-02' });

      render(
        <>
          <Row asset={mystery} state="running" />
          <Row asset={known} state="running" />
        </>,
      );
      const [unknownRow, knownRow] = screen.getAllByRole('button');

      expect(within(unknownRow!).getByText('mystery_pump')).toBeInTheDocument();
      // `unknownIcon` against the cooling tower's: two different lucide glyphs.
      const glyph = (el: HTMLElement) => el.querySelector('svg')?.getAttribute('class');
      expect(glyph(unknownRow!)).not.toBe(glyph(knownRow!));
    });
  });

  describe('selection and hover', () => {
    it('marks the selected asset with aria-current', () => {
      useConsole.setState({ selectedAssetCode: 'CT-01' });

      render(<Row />);

      expect(row()).toHaveAttribute('aria-current', 'true');
    });

    it('is not current for another asset', () => {
      useConsole.setState({ selectedAssetCode: 'CT-02' });

      render(<Row />);

      expect(row()).toHaveAttribute('aria-current', 'false');
    });

    it('selects on click and deselects on a second click', async () => {
      render(<Row />);

      await userEvent.click(row());
      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(row()).toHaveAttribute('aria-current', 'true');

      await userEvent.click(row());
      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    it('selects with Enter', async () => {
      render(<Row />);
      act(() => row().focus());

      await userEvent.keyboard('{Enter}');

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
    });

    it('selects with Space', async () => {
      render(<Row />);
      act(() => row().focus());

      await userEvent.keyboard(' ');

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
    });

    it('sets and clears the hovered asset with the pointer', async () => {
      render(<Row />);

      await userEvent.hover(row());
      expect(useConsole.getState().hoveredAssetCode).toBe('CT-01');

      await userEvent.unhover(row());
      expect(useConsole.getState().hoveredAssetCode).toBeNull();
    });

    // The map's hover over this asset's marker (V2-10.4): the row says so, and moves nothing.
    it('is marked hovered while the map hovers its asset, and no other row is', () => {
      render(<Row />);
      expect(row()).not.toHaveAttribute('data-hovered');

      act(() => useConsole.getState().hoverAsset('CT-01'));
      expect(row()).toHaveAttribute('data-hovered', 'true');

      act(() => useConsole.getState().hoverAsset('CT-02'));
      expect(row()).not.toHaveAttribute('data-hovered');

      act(() => useConsole.getState().hoverAsset(null));
      expect(row()).not.toHaveAttribute('data-hovered');
    });

    it('takes no focus and selects nothing when it is only marked hovered', () => {
      render(<Row />);

      act(() => useConsole.getState().hoverAsset('CT-01'));

      expect(row()).not.toHaveFocus();
      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    it('does not set the hovered asset on keyboard focus', () => {
      render(<Row />);

      act(() => row().focus());

      expect(useConsole.getState().hoveredAssetCode).toBeNull();
    });
  });

  describe('the roving list', () => {
    it('is a tab stop only when the list says so', () => {
      const { rerender } = render(<Row tabIndex={0} />);
      expect(row()).toHaveAttribute('tabindex', '0');

      rerender(<Row tabIndex={-1} />);
      expect(row()).toHaveAttribute('tabindex', '-1');
    });

    it('hands its element to the list under its key, and takes it back on unmount', () => {
      const { unmount } = render(<Row />);

      expect(register).toHaveBeenCalledWith('asset:CT-01', row());

      unmount();
      expect(register).toHaveBeenLastCalledWith('asset:CT-01', null);
    });

    it('tells the list which item holds focus', () => {
      render(<Row />);

      act(() => row().focus());

      expect(onFocusItem).toHaveBeenCalledWith('asset:CT-01');
    });
  });

  // The list re-renders every second with the server clock; a row must not follow it.
  describe('re-rendering', () => {
    it('re-renders for its own asset and not for the reading of another', () => {
      const other = asset({ id: 'asset-ct-02', code: 'CT-02', name: 'Cooling tower 2' });
      const one = entry({ fanSpeedRpm: 1420 });
      const two = entry({ fanSpeedRpm: 900 });
      holdAssets({ 'CT-01': one, 'CT-02': two });
      const commits = { first: 0, second: 0 };

      render(
        <>
          <Profiler id="first" onRender={() => (commits.first += 1)}>
            <Row asset={asset()} />
          </Profiler>
          <Profiler id="second" onRender={() => (commits.second += 1)}>
            <Row asset={other} />
          </Profiler>
        </>,
      );
      const before = { ...commits };

      // CT-02 changes; the reducer keeps CT-01's object, as the telemetry reducer does.
      holdAssets({ 'CT-01': one, 'CT-02': entry({ fanSpeedRpm: 950 }) });

      expect(commits.first).toBe(before.first);
      expect(commits.second).toBe(before.second + 1);
      expect(screen.getByText('950 rpm')).toBeInTheDocument();
    });
  });
});
