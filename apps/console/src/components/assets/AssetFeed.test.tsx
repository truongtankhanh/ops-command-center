import type { Asset, Incident, TelemetryPoint, TelemetryValue, Zone } from '@occ/contracts';
import { QueryClient } from '@tanstack/react-query';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  queryRetryDelay,
  RATE_LIMITED_RETRYING,
  shouldRetryQuery,
  TOO_MANY_REQUESTS,
} from '../../api/client';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import { initialTelemetryState, type TelemetryState } from '../../lib/telemetry/telemetryState';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../../test-utils';
import { AssetFeed } from './AssetFeed';

// No token in these cases; the API client only asks for one.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const point: TelemetryPoint = {
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
};

const asset = (overrides: Partial<Asset>): Asset => ({
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
  headline: [point],
  ...overrides,
});

const zones: Zone[] = [
  {
    id: 'zone-dc',
    code: 'BLD-DC',
    name: 'Data Center',
    kind: 'building',
    polygon: [],
    center: [0, 0],
  },
  {
    id: 'zone-lib',
    code: 'BLD-LIB',
    name: 'Library',
    kind: 'building',
    polygon: [],
    center: [0, 0],
  },
];

const assets: Asset[] = [
  asset({}),
  asset({ id: 'asset-ct-02', code: 'CT-02', name: 'Cooling tower 2' }),
  asset({ id: 'asset-lks-b3', code: 'LKS-B3', name: 'Leak sensor B3', zoneId: 'zone-lib' }),
];

// CT-01 raised this one: a fault. Nothing is in the telemetry overview, so the other two have no data.
const incidents: Incident[] = [
  {
    id: 'inc-1',
    code: 'INC-000001',
    type: 'equipment_fault',
    severity: 'high',
    status: 'open',
    title: 'Fan fault',
    description: null,
    zoneId: 'zone-dc',
    position: [0, 0],
    source: 'telemetry',
    assetId: 'asset-ct-01',
    reportedAt: new Date().toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
  },
];

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A cache with the catalogue, the incidents and the zones; no request is needed. */
function seeded(list: Asset[] = assets, raised: Incident[] = incidents): QueryClient {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, list);
  client.setQueryData(queryKeys.incidents, raised);
  client.setQueryData(queryKeys.zones, zones);
  return client;
}

/** A cache with no catalogue: the feed asks the API for it (`fetchMock`). */
function unseeded(client = createTestQueryClient()): QueryClient {
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.zones, zones);
  return client;
}

const searchbox = () => screen.getByRole('searchbox', { name: 'Search assets' });

// A local time, so a clock text does not depend on the runner's timezone.
const NOW = new Date(2026, 9, 15, 15, 41, 20).getTime();
const receivedAgo = (agoMs: number) => new Date(NOW - agoMs).toISOString();

interface Held {
  /** How long before the server's now the reading was received; 1 s is live for a 1 s asset. */
  agoMs?: number;
  online?: boolean;
  values?: Record<string, TelemetryValue>;
}

/**
 * What the telemetry store holds: overview entries by asset code, a server clock at `NOW`, and
 * the link (`socket`, `upstream`...). Wrapped in `act`, as a store change outside React must be.
 */
function hold(entries: Record<string, Held>, link: Partial<TelemetryState> = {}) {
  const held = Object.fromEntries(
    Object.entries(entries).map(([code, { agoMs = 1000, online = true, values = {} }]) => [
      code,
      { online, receivedAt: receivedAgo(agoMs), headline: {}, values, keyReceivedAt: {} },
    ]),
  );
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          socket: 'live',
          upstream: 'live',
          serverClock: { at: NOW, mono: performance.now() },
          ...link,
          assets: held,
        },
        series: new Map(),
      },
    }),
  );
}

const rowNamed = (name: RegExp) => screen.getByRole('button', { name });
const header = (zone: string) => screen.getByRole('button', { name: `Show only ${zone}` });
/** Every row's and header's button, in reading order: what the keyboard walks. */
const stops = () => within(screen.getByRole('tabpanel')).getAllByRole('button');

describe('AssetFeed', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    resetStore(useTelemetryStore);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
    fetchMock.mockReset().mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('the shell', () => {
    it('names the section, the search and the filter tabs after frame 03', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByRole('region', { name: 'Assets' })).toBeInTheDocument();
      expect(searchbox()).toHaveAttribute('placeholder', 'Search asset, code or zone');
      expect(screen.getByRole('tablist', { name: 'Filter assets' })).toBeInTheDocument();
    });

    it('counts each filter tab, in the tab name', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByRole('tab', { name: 'All 3' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Faults 1' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
      expect(screen.getByRole('tab', { name: 'No data 2' })).toBeInTheDocument();
    });

    it('lists the assets of a catalogue under the tabs, not an empty list', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getAllByRole('list').length).toBeGreaterThan(0);
      expect(screen.queryByText('No assets are set up on this site.')).toBeNull();
      expect(rowNamed(/Cooling tower 1/)).toBeInTheDocument();
    });

    it('selects a filter tab in the store', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(screen.getByRole('tab', { name: 'Faults 1' }));

      expect(useConsole.getState().assetFilter).toBe('faults');
      expect(screen.getByRole('tab', { name: 'Faults 1' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('shows the same console to a viewer', () => {
      useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] });

      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByRole('tab', { name: 'All 3' })).toBeInTheDocument();
    });
  });

  describe('the list', () => {
    it('groups the assets by zone, A–Z, with the zone as a header', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      const headers = screen
        .getAllByRole('button', { name: /^Show only / })
        .map((button) => button.textContent);

      expect(headers).toEqual(['Data Center', 'Library']);
      const dataCenter = within(screen.getByRole('list', { name: 'Data Center' }));
      expect(dataCenter.getAllByRole('button')).toHaveLength(2);
      expect(
        within(screen.getByRole('list', { name: 'Library' })).getByText('Leak sensor B3'),
      ).toBeInTheDocument();
    });

    it('gives each row its value and its state word', () => {
      hold({
        'CT-01': { values: { running: true, fanSpeedRpm: 1420 } },
        'CT-02': { values: { running: false, fanSpeedRpm: 0 } },
        'LKS-B3': { values: { running: true, fanSpeedRpm: 900 } },
      });
      renderWithQueryClient(<AssetFeed />, seeded());

      const ct01 = within(rowNamed(/Cooling tower 1/));
      expect(ct01.getByText('1,420 rpm')).toBeInTheDocument();
      expect(ct01.getByText(/Fault · INC-000001/)).toBeInTheDocument();
      const ct02 = within(rowNamed(/Cooling tower 2/));
      expect(ct02.getByText('0 rpm')).toBeInTheDocument();
      expect(ct02.getByText('Standby')).toBeInTheDocument();
      expect(within(rowNamed(/Leak sensor B3/)).getByText('Running')).toBeInTheDocument();
    });

    it('dims and ages a stale asset, and says offline for one whose device went', () => {
      hold({
        'CT-01': { values: { fanSpeedRpm: 1420 } },
        'CT-02': { agoMs: 65_000, values: { running: true, fanSpeedRpm: 1420 } },
        'LKS-B3': { agoMs: 190_000, online: false, values: { fanSpeedRpm: 900 } },
      });
      renderWithQueryClient(<AssetFeed />, seeded());

      const stale = within(rowNamed(/Cooling tower 2/));
      expect(stale.getByText('No data · 1 min')).toBeInTheDocument();
      expect(stale.getByText('1,420 rpm')).toHaveAttribute('data-stale', 'true');
      expect(within(rowNamed(/Leak sensor B3/)).getByText('Offline · 3 min')).toBeInTheDocument();
    });

    it('says no data, with no value, for an asset it has nothing of', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      const row = within(rowNamed(/Cooling tower 2/));
      expect(row.getByText('No data')).toBeInTheDocument();
      expect(row.getByText('—')).toBeInTheDocument();
    });

    it('lists exactly the faults in Faults, with the incident code, and the count matches', async () => {
      hold({ 'CT-02': { values: { running: true } }, 'LKS-B3': { values: { running: true } } });
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(screen.getByRole('tab', { name: 'Faults 1' }));

      expect(
        within(screen.getByRole('tabpanel')).getAllByRole('button', { name: /Cooling/ }),
      ).toHaveLength(1);
      expect(screen.getByText(/Fault · INC-000001/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cooling tower 2/ })).toBeNull();
    });

    it('lists stale and offline assets in No data, and the count matches', async () => {
      hold({
        'CT-01': {},
        'CT-02': { agoMs: 65_000, values: { running: true } },
        'LKS-B3': { online: false, values: {} },
      });
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(screen.getByRole('tab', { name: 'No data 2' }));

      expect(rowNamed(/Cooling tower 2/)).toBeInTheDocument();
      expect(rowNamed(/Leak sensor B3/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cooling tower 1/ })).toBeNull();
    });

    it('draws the raw class of an asset whose class it does not know', () => {
      const odd = asset({
        id: 'asset-odd',
        code: 'ODD-01',
        name: 'Odd machine',
        class: { ...asset({}).class, code: 'mystery_pump', name: 'Mystery pump' },
      });
      renderWithQueryClient(<AssetFeed />, seeded([...assets, odd]));

      const row = within(rowNamed(/Odd machine/));
      expect(row.getByText('mystery_pump')).toBeInTheDocument();
      expect(row.getByText('—')).toBeInTheDocument();
    });

    it('selects an asset on click and marks it current', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(rowNamed(/Cooling tower 2/));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-02');
      expect(rowNamed(/Cooling tower 2/)).toHaveAttribute('aria-current', 'true');
    });
  });

  // V2-15.2: selecting a row focuses the building its zone is, for the 3D view; the list stays as it is.
  describe('the building focus', () => {
    const plant: Zone = {
      id: 'zone-plant',
      code: 'UTL-PLANT',
      name: 'Utility Plant',
      kind: 'utility',
      polygon: [],
      center: [0, 0],
    };
    const transformer = asset({
      id: 'asset-tr-01',
      code: 'TR-01',
      name: 'Main transformer',
      zoneId: 'zone-plant',
    });

    it('focuses the building of the selected asset and leaves the list unfiltered', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(rowNamed(/Cooling tower 2/));

      expect(useConsole.getState().focusZoneId).toBe('zone-dc');
      expect(useConsole.getState().assetZoneId).toBeNull();
      expect(rowNamed(/Leak sensor B3/)).toBeInTheDocument();
    });

    it('focuses nothing for an asset in a zone that is not a building', async () => {
      const client = seeded([...assets, transformer]);
      client.setQueryData(queryKeys.zones, [...zones, plant]);
      // Not `focusBuilding`: that would filter the list to the Data Center and hide the transformer.
      useConsole.setState({ focusZoneId: 'zone-dc' });
      renderWithQueryClient(<AssetFeed />, client);

      await userEvent.click(rowNamed(/Main transformer/));

      expect(useConsole.getState().selectedAssetCode).toBe('TR-01');
      expect(useConsole.getState().focusZoneId).toBeNull();
    });

    it('keeps the building in focus when the selected row is clicked again', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());
      await userEvent.click(rowNamed(/Cooling tower 2/));

      await userEvent.click(rowNamed(/Cooling tower 2/));

      expect(useConsole.getState().selectedAssetCode).toBeNull();
      expect(useConsole.getState().focusZoneId).toBe('zone-dc');
    });

    it('leaves a zone chip the operator chose as it was', async () => {
      useConsole.getState().setAssetZone('zone-dc');
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(rowNamed(/Cooling tower 2/));
      act(() => useConsole.getState().goCampus());

      expect(useConsole.getState().assetZoneId).toBe('zone-dc');
    });
  });

  describe('the zone chip', () => {
    it('is set by a header, narrows the list and the counts, and moves focus to the chip', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(header('Library'));

      expect(useConsole.getState().assetZoneId).toBe('zone-lib');
      expect(screen.getByText('Library only')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'All 1' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Cooling tower/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Clear zone filter' })).toHaveFocus();
    });

    it('leaves the one group a plain label, not a button that does nothing', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(header('Library'));

      expect(screen.queryByRole('button', { name: /^Show only/ })).toBeNull();
      expect(within(screen.getByRole('tabpanel')).getAllByText('Library').length).toBeGreaterThan(
        0,
      );
    });

    it('clears with ×, shows every zone again and focuses the selected tab', async () => {
      useConsole.setState({ assetZoneId: 'zone-lib' });
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.click(screen.getByRole('button', { name: 'Clear zone filter' }));

      expect(useConsole.getState().assetZoneId).toBeNull();
      expect(screen.getByRole('tab', { name: 'All 3' })).toHaveFocus();
      expect(header('Data Center')).toBeInTheDocument();
    });
  });

  describe('the notice', () => {
    it('says nothing while telemetry is live', () => {
      hold({ 'CT-02': { values: { running: true } } });
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.queryByText(/not updating|No readings/)).toBeNull();
    });

    it('says nothing while the first connection is made', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.queryByText(/not updating|No readings/)).toBeNull();
    });

    it('reads as of the newest reading while the API source is paused, and clears on resume', () => {
      hold(
        { 'CT-02': { agoMs: 0, values: { running: true } } },
        { upstream: 'paused', upstreamSince: receivedAgo(30_000) },
      );
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByText('Readings as of 15:41:20 — not updating')).toBeInTheDocument();

      hold({ 'CT-02': { values: { running: true } } }, { upstream: 'live' });

      expect(screen.queryByText(/not updating/)).toBeNull();
    });

    it('reads the same while this console is reconnecting', () => {
      hold(
        { 'CT-02': { agoMs: 0, values: { running: true } } },
        { socket: 'reconnecting', socketSince: NOW },
      );
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByText('Readings as of 15:41:20 — not updating')).toBeInTheDocument();
    });

    it('says telemetry is unavailable on an API without it', () => {
      hold({}, { socket: 'unavailable' });
      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByText('No readings: telemetry is unavailable')).toBeInTheDocument();
    });
  });

  describe('the keyboard', () => {
    it('is one Tab stop for the headers and the rows together', () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      const tabbable = stops().filter((button) => button.getAttribute('tabindex') === '0');

      expect(tabbable).toHaveLength(1);
      expect(tabbable[0]).toBe(header('Data Center'));
    });

    it('walks headers and rows with the arrows, Home and End, without wrapping', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());
      act(() => header('Data Center').focus());

      await userEvent.keyboard('{ArrowDown}');
      expect(rowNamed(/Cooling tower 1/)).toHaveFocus();

      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      expect(header('Library')).toHaveFocus();

      await userEvent.keyboard('{End}');
      expect(rowNamed(/Leak sensor B3/)).toHaveFocus();

      await userEvent.keyboard('{ArrowDown}');
      expect(rowNamed(/Leak sensor B3/)).toHaveFocus();

      await userEvent.keyboard('{Home}');
      expect(header('Data Center')).toHaveFocus();
    });

    it('moves the Tab stop to the item focused last', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      act(() => rowNamed(/Cooling tower 2/).focus());

      expect(rowNamed(/Cooling tower 2/)).toHaveAttribute('tabindex', '0');
      expect(header('Data Center')).toHaveAttribute('tabindex', '-1');
    });

    it('starts the Tab stop on the selected asset', () => {
      useConsole.setState({ selectedAssetCode: 'LKS-B3' });

      renderWithQueryClient(<AssetFeed />, seeded());

      expect(rowNamed(/Leak sensor B3/)).toHaveAttribute('tabindex', '0');
    });

    it('selects an asset with Enter and filters by a zone with Enter on its header', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());
      act(() => rowNamed(/Cooling tower 2/).focus());

      await userEvent.keyboard('{Enter}');
      expect(useConsole.getState().selectedAssetCode).toBe('CT-02');

      act(() => header('Library').focus());
      await userEvent.keyboard('{Enter}');
      expect(useConsole.getState().assetZoneId).toBe('zone-lib');
    });
  });

  describe('when nothing is left to list', () => {
    it('says no assets have a fault', async () => {
      renderWithQueryClient(<AssetFeed />, seeded(assets, []));

      await userEvent.click(screen.getByRole('tab', { name: 'Faults 0' }));

      expect(screen.getByText('No assets have a fault.')).toBeInTheDocument();
    });

    it('says which search matched nothing', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.type(searchbox(), 'zzz');

      expect(screen.getByText('No assets match "zzz".')).toBeInTheDocument();
    });

    it('names the zone when it is the zone that is empty of faults', () => {
      useConsole.setState({ assetZoneId: 'zone-lib', assetFilter: 'faults' });

      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByText('No assets in Library have a fault.')).toBeInTheDocument();
    });
  });

  describe('the hovered asset', () => {
    it('is dropped when the search takes its row out of the list', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());
      act(() => useConsole.getState().hoverAsset('LKS-B3'));

      await userEvent.type(searchbox(), 'tower');

      expect(useConsole.getState().hoveredAssetCode).toBeNull();
    });

    it('is left alone while its row is still listed', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());
      act(() => useConsole.getState().hoverAsset('CT-02'));

      await userEvent.type(searchbox(), 'tower');

      expect(useConsole.getState().hoveredAssetCode).toBe('CT-02');
    });
  });

  describe('search and zone', () => {
    it('narrows every count by the search, matching name, code and zone', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.type(searchbox(), 'leak');

      expect(screen.getByRole('tab', { name: 'All 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Faults 0' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'No data 1' })).toBeInTheDocument();
      expect(screen.getByText('1 asset matches')).toBeInTheDocument();
    });

    it('matches the zone name, folded for case', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.type(searchbox(), 'DATA center');

      expect(screen.getByRole('tab', { name: 'All 2' })).toBeInTheDocument();
      expect(screen.getByText('2 assets match')).toBeInTheDocument();
    });

    it('narrows every count by the chosen zone', () => {
      useConsole.setState({ assetZoneId: 'zone-lib' });

      renderWithQueryClient(<AssetFeed />, seeded());

      expect(screen.getByRole('tab', { name: 'All 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Faults 0' })).toBeInTheDocument();
    });
  });

  describe('loading and errors', () => {
    it('shows placeholder rows while the catalogue loads, and no counts', () => {
      renderWithQueryClient(<AssetFeed />, unseeded());

      const loading = screen.getByText('Loading assets…');
      expect(loading).toHaveAttribute('role', 'status');
      expect(loading.parentElement).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    });

    it('says the catalogue could not be loaded, and retries', async () => {
      fetchMock
        .mockImplementationOnce(async () => json({ statusCode: 500, message: 'Internal' }, 500))
        .mockImplementationOnce(async () => json(assets));
      renderWithQueryClient(<AssetFeed />, unseeded());

      expect(await screen.findByText('Assets could not be loaded.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('tab', { name: 'All 3' })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('waits calmly while too many requests are retried', async () => {
      // The console's own policy: a 429 is retried after 2 s, which this case never waits for.
      const client = new QueryClient({
        defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay } },
      });
      fetchMock.mockImplementationOnce(async () =>
        json({ statusCode: 429, message: 'Too many requests' }, 429),
      );
      const { unmount } = renderWithQueryClient(<AssetFeed />, unseeded(client));

      const retrying = await screen.findByText(RATE_LIMITED_RETRYING);
      expect(retrying.closest('[role="status"]')).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

      unmount();
      await client.cancelQueries();
    });

    it('explains too many requests once the retries are over', async () => {
      fetchMock.mockImplementationOnce(async () =>
        json({ statusCode: 429, message: 'Too many requests' }, 429),
      );
      renderWithQueryClient(<AssetFeed />, unseeded());

      expect(await screen.findByText(TOO_MANY_REQUESTS)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('says no assets are set up for an empty catalogue', () => {
      renderWithQueryClient(<AssetFeed />, seeded([]));

      expect(screen.getByText('No assets are set up on this site.')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'All 0' })).toBeInTheDocument();
    });

    // An API from before V2-05 has no route (ADR-0018 § Rolling deploys): "no assets", not an error.
    it('reads a 404 as an empty catalogue', async () => {
      fetchMock.mockImplementationOnce(async () =>
        json({ statusCode: 404, message: 'Not Found' }, 404),
      );
      renderWithQueryClient(<AssetFeed />, unseeded());

      expect(await screen.findByText('No assets are set up on this site.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
  });

  describe('the / shortcut', () => {
    it('focuses the search while the assets are the visible panel', async () => {
      useConsole.setState({ sidePanel: 'assets' });
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.keyboard('/');

      expect(searchbox()).toHaveFocus();
    });

    it('leaves the key to the incident feed while the incidents are visible', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());

      await userEvent.keyboard('/');

      expect(searchbox()).not.toHaveFocus();
    });

    it('follows a change of panel', async () => {
      renderWithQueryClient(<AssetFeed />, seeded());
      act(() => useConsole.getState().setSidePanel('assets'));

      await userEvent.keyboard('/');

      expect(searchbox()).toHaveFocus();
    });
  });
});
