import type { Asset, Camera, Incident, TelemetryPoint, Zone } from '@occ/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { queryKeys } from '../api/queries';
import { MAP_LAYERS } from '../lib/map/mapLayers';
import { formatReading } from '../lib/assets/readings';
import { type AssetTelemetryState, initialTelemetryState } from '../lib/telemetry/telemetryState';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { MapTooltip } from './MapTooltip';

type Handler = (event?: unknown) => void;

/**
 * The few calls the tooltip makes on its map. MapLibre itself needs WebGL, which jsdom does not
 * have; the tooltip only uses the instance it is given, so no module mock is needed.
 */
function fakeMap({ width = 800, at = { x: 400, y: 300 } } = {}) {
  const handlers = new Map<string, Set<Handler>>();
  const canvas = { style: { cursor: '' } };
  return {
    canvas,
    on: vi.fn((event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    }),
    fire(event: string, payload?: unknown) {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    queryRenderedFeatures: vi.fn((): unknown[] => []),
    getCanvas: () => canvas,
    project: vi.fn(() => at),
    getContainer: () => ({ clientWidth: width }),
  };
}

type FakeMap = ReturnType<typeof fakeMap>;

const POSITION: [number, number] = [108.44, 11.95];

const zone: Zone = {
  id: 'z1',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [],
  center: POSITION,
};

/** Reported five minutes ago, so the age reads "5m" without fake timers. */
const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'a',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'high',
  status: 'open',
  title: 'Door forced open',
  description: null,
  zoneId: 'z1',
  position: POSITION,
  source: 'operator',
  reportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

const camera = (overrides: Partial<Camera> = {}): Camera => ({
  id: 'c1',
  code: 'CAM-D02',
  name: 'Data center loading bay',
  zoneId: 'z1',
  position: POSITION,
  online: true,
  fieldOfView: null,
  ...overrides,
});

/** A feature as `queryRenderedFeatures` reports it. */
const hit = (layerId: string, properties: Record<string, unknown>) => ({
  layer: { id: layerId },
  properties,
  geometry: { type: 'Point', coordinates: POSITION },
});

function renderTooltip(
  map: FakeMap | null,
  {
    incidents = [] as Incident[],
    cameras = [] as Camera[],
    zones = [zone],
    assets = [] as Asset[],
  }: { incidents?: Incident[]; cameras?: Camera[]; zones?: Zone[]; assets?: Asset[] } = {},
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.cameras, cameras);
  client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.assets, assets);
  return renderWithQueryClient(<MapTooltip map={map as unknown as MapLibreMap | null} />, client);
}

/** Moves the pointer over `hits`, topmost first. */
function hover(map: FakeMap, ...hits: unknown[]) {
  map.queryRenderedFeatures.mockReturnValueOnce(hits);
  act(() => map.fire('mousemove', { point: { x: 0, y: 0 } }));
}

/**
 * The tooltip element. A selector, not a role: the tooltip is `aria-hidden` on purpose (the feed
 * is the accessible route), so it has no role to query by.
 */
const tooltip = () => document.querySelector<HTMLElement>('[data-placement]');

const point = (key: string, label: string, unit: string): TelemetryPoint => ({
  key,
  label,
  unit,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
});

const FAN = point('fanSpeedRpm', 'Fan speed', 'rpm');
const MOTOR = point('motorTempC', 'Motor temperature', '°C');

/** A cooling tower in the library: its state point is `running`, which the telemetry carries. */
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
  zoneId: 'z1',
  position: POSITION,
  elevationM: 0,
  headingDeg: 0,
  headline: [FAN, MOTOR],
  ...overrides,
});

/**
 * What the console holds of an asset, with the API's clock anchored now, so `ageSeconds` is how old
 * the latest reading reads. Set before the tooltip renders: `useServerNow` reads the clock once.
 */
function holdTelemetry(
  entries: Record<string, Partial<AssetTelemetryState> & { ageSeconds?: number }>,
) {
  const at = Date.now();
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at, mono: performance.now() },
          assets: Object.fromEntries(
            Object.entries(entries).map(([code, { ageSeconds = 3, ...rest }]) => [
              code,
              {
                online: true,
                receivedAt: new Date(at - ageSeconds * 1000).toISOString(),
                headline: {},
                values: { fanSpeedRpm: 1420, motorTempC: 62.5, running: true },
                keyReceivedAt: {},
                ...rest,
              } satisfies AssetTelemetryState,
            ]),
          ),
        },
        series: new Map(),
      },
    }),
  );
}

describe('MapTooltip', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useTelemetryStore);
  });

  it('describes the incident under the pointer', () => {
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident()] });

    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    expect(screen.getByText('Door forced open')).toBeInTheDocument();
    expect(screen.getByText('INC-000001 · Library · 5m')).toBeInTheDocument();
    // Severity and status share one line, so they are read from the tooltip as a whole.
    expect(tooltip()).toHaveTextContent('High');
    expect(tooltip()).toHaveTextContent('Open');
  });

  it('describes an incident whose type this console does not know', () => {
    // A newer API can send a type this build's contract lacks (ADR-0021, rolling deploys); the
    // type system cannot model it, hence the cast.
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident({ type: 'not_in_contract' as Incident['type'] })] });

    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    expect(screen.getByText('Door forced open')).toBeInTheDocument();
    expect(screen.getByText('INC-000001 · Library · 5m')).toBeInTheDocument();
  });

  it('anchors above the marker where the map projects it', () => {
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident()] });

    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    expect(map.project).toHaveBeenCalledWith(POSITION);
    expect(tooltip()!.style.left).toBe('400px');
    expect(tooltip()!.style.top).toBe('300px');
    expect(tooltip()).toHaveAttribute('data-placement', 'above');
  });

  it('summarises a cluster', () => {
    const map = fakeMap();
    renderTooltip(map);

    hover(map, hit(MAP_LAYERS.clusters, { cluster_id: 7, point_count: 4, sevRank: 3 }));

    expect(screen.getByText('4 incidents')).toBeInTheDocument();
    expect(screen.getByText('Highest: Critical')).toBeInTheDocument();
    expect(screen.getByText('Click to zoom in')).toBeInTheDocument();
  });

  it('names an offline camera', () => {
    const map = fakeMap();
    renderTooltip(map, { cameras: [camera({ online: false })] });

    hover(map, hit(MAP_LAYERS.cameras, { id: 'c1' }));

    expect(screen.getByText('Data center loading bay')).toBeInTheDocument();
    expect(screen.getByText('CAM-D02 · Library · Offline')).toBeInTheDocument();
  });

  it("says nothing about an online camera's state", () => {
    const map = fakeMap();
    renderTooltip(map, { cameras: [camera()] });

    hover(map, hit(MAP_LAYERS.cameras, { id: 'c1' }));

    expect(screen.getByText('CAM-D02 · Library')).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it('points only at what a click acts on', () => {
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident()], cameras: [camera()] });

    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));
    expect(map.canvas.style.cursor).toBe('pointer');

    hover(map, hit(MAP_LAYERS.clusters, { cluster_id: 7, point_count: 2, sevRank: 1 }));
    expect(map.canvas.style.cursor).toBe('pointer');

    // A camera opens the viewer (UI-13).
    hover(map, hit(MAP_LAYERS.cameras, { id: 'c1' }));
    expect(map.canvas.style.cursor).toBe('pointer');

    hover(map);
    expect(map.canvas.style.cursor).toBe('');
  });

  it('follows an acknowledge while it is open', async () => {
    const map = fakeMap();
    const { client } = renderTooltip(map, { incidents: [incident()] });
    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    // A live change carries a higher version; the incidents cache ignores a copy that is not newer.
    act(() =>
      client.setQueryData(queryKeys.incidents, [incident({ status: 'acknowledged', version: 2 })]),
    );

    // The status shares a line with the severity, so it is matched on the tooltip, not found alone.
    await waitFor(() => expect(tooltip()).toHaveTextContent('Being handled'));
  });

  it('closes when the incident leaves the map', async () => {
    const map = fakeMap();
    const { client } = renderTooltip(map, { incidents: [incident()] });
    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    act(() =>
      client.setQueryData(queryKeys.incidents, [incident({ status: 'resolved', version: 2 })]),
    );

    await waitFor(() => expect(screen.queryByText('Door forced open')).toBeNull());
  });

  it('stays on a resolved incident that is still selected', async () => {
    const map = fakeMap();
    const { client } = renderTooltip(map, { incidents: [incident()] });
    act(() => useConsole.getState().select('a'));
    hover(map, hit(MAP_LAYERS.selected, { id: 'a' }));

    act(() =>
      client.setQueryData(queryKeys.incidents, [incident({ status: 'resolved', version: 2 })]),
    );

    await waitFor(() => expect(tooltip()).toHaveTextContent('Resolved'));
  });

  it('points out nothing while the report location is picked', () => {
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident()] });
    // While picking a click places the pin, and `CampusMap` owns the crosshair cursor.
    act(() => useConsole.getState().setPicking(true));

    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    expect(tooltip()).toBeNull();
    expect(map.canvas.style.cursor).toBe('');
  });

  // V2-10.4: frame 14's asset tooltip, from what the console already holds (no watch).
  describe('an asset', () => {
    const overAsset = (map: FakeMap, code = 'CT-01') =>
      hover(map, hit(MAP_LAYERS.assets, { code }));

    it('names the asset and its code, and says where a click leads', () => {
      holdTelemetry({ 'CT-01': {} });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()).toHaveTextContent('Cooling tower 1');
      expect(tooltip()).toHaveTextContent('CT-01');
      expect(tooltip()).toHaveTextContent('Click to inspect · Library');
    });

    it('says the state in the list’s words', () => {
      holdTelemetry({ 'CT-01': {} });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()).toHaveTextContent('Running');
    });

    it('shows the two headline readings from the overview, formatted as the list does', () => {
      holdTelemetry({ 'CT-01': {} });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()).toHaveTextContent('Fan speed');
      expect(tooltip()).toHaveTextContent(formatReading(FAN, 1420));
      expect(tooltip()).toHaveTextContent('Motor temperature');
      expect(tooltip()).toHaveTextContent(formatReading(MOTOR, 62.5));
    });

    it('draws a dash for a reading it has no value for', () => {
      holdTelemetry({ 'CT-01': { values: { fanSpeedRpm: 1420 } } });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()).toHaveTextContent('Motor temperature—');
    });

    // One age for the asset, not one per reading (V2-08.3): a steady reading would read "old".
    it('says how old the latest reading is, once, while it is live', () => {
      holdTelemetry({ 'CT-01': { ageSeconds: 3 } });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()?.textContent?.match(/Updated 3 s ago/g)).toHaveLength(1);
    });

    it('says no data with its age, and dims the last values, when the reading is old', () => {
      holdTelemetry({ 'CT-01': { ageSeconds: 90 } });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()).toHaveTextContent('No data · 1 min');
      expect(tooltip()).toHaveTextContent('1 min 30 s old');
      expect(tooltip()?.querySelector('dd')).toHaveAttribute('data-stale', 'true');
    });

    it('says offline when the device’s last will fired', () => {
      holdTelemetry({ 'CT-01': { online: false, ageSeconds: 30 } });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()).toHaveTextContent('Offline · 30 s');
    });

    it('says a fault with the incident code, even when the reading is old', () => {
      holdTelemetry({ 'CT-01': { ageSeconds: 600 } });
      const map = fakeMap();
      renderTooltip(map, {
        assets: [asset()],
        incidents: [incident({ id: 'inc', code: 'INC-000108', assetId: 'asset-ct-01' })],
      });

      overAsset(map);

      expect(tooltip()).toHaveTextContent('Fault · INC-000108');
    });

    it('says only what it knows for an asset nothing was received about', () => {
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()).toHaveTextContent('No data');
      expect(tooltip()).not.toHaveTextContent('Updated');
      expect(tooltip()).toHaveTextContent('Fan speed—');
    });

    it('leaves the zone out of the foot when the zone is unknown', () => {
      holdTelemetry({ 'CT-01': {} });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset({ zoneId: 'gone' })] });

      overAsset(map);

      expect(tooltip()).toHaveTextContent(/Click to inspect$/);
    });

    it('anchors at the marker where the map projects it, and shows a pointer', () => {
      holdTelemetry({ 'CT-01': {} });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(map.project).toHaveBeenCalledWith(POSITION);
      expect(map.canvas.style.cursor).toBe('pointer');
    });

    it('says nothing about an asset the catalogue does not hold', () => {
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map, 'NOT-THERE');

      expect(tooltip()).toBeNull();
    });

    it('is hidden from assistive tech like the others', () => {
      holdTelemetry({ 'CT-01': {} });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });

      overAsset(map);

      expect(tooltip()).toHaveAttribute('aria-hidden', 'true');
    });

    describe('the row that mirrors it', () => {
      it('tells the console which asset is hovered, once, and clears it when the pointer leaves', () => {
        holdTelemetry({ 'CT-01': {} });
        const map = fakeMap();
        renderTooltip(map, { assets: [asset()] });

        overAsset(map);
        expect(useConsole.getState().hoveredAssetCode).toBe('CT-01');

        act(() => map.fire('mouseout'));
        expect(useConsole.getState().hoveredAssetCode).toBeNull();
      });

      it('clears it when the pointer moves on to something that is not an asset', () => {
        holdTelemetry({ 'CT-01': {} });
        const map = fakeMap();
        renderTooltip(map, { assets: [asset()], incidents: [incident()] });
        overAsset(map);

        hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

        expect(useConsole.getState().hoveredAssetCode).toBeNull();
      });

      it('moves it from one asset to the next without a gap', () => {
        holdTelemetry({ 'CT-01': {}, 'CT-02': {} });
        const map = fakeMap();
        renderTooltip(map, {
          assets: [asset(), asset({ id: 'asset-ct-02', code: 'CT-02', name: 'Cooling tower 2' })],
        });
        overAsset(map, 'CT-01');

        overAsset(map, 'CT-02');

        expect(useConsole.getState().hoveredAssetCode).toBe('CT-02');
      });

      it('does not clear a hover that a row took over meanwhile', () => {
        holdTelemetry({ 'CT-01': {} });
        const map = fakeMap();
        renderTooltip(map, { assets: [asset()] });
        overAsset(map);

        // The pointer reached a row in the list, which sets its own asset, then the map sees it leave.
        act(() => useConsole.getState().hoverAsset('CT-02'));
        act(() => map.fire('mouseout'));

        expect(useConsole.getState().hoveredAssetCode).toBe('CT-02');
      });

      it('sets nothing while the report location is picked', () => {
        holdTelemetry({ 'CT-01': {} });
        const map = fakeMap();
        renderTooltip(map, { assets: [asset()] });
        act(() => useConsole.getState().setPicking(true));

        overAsset(map);

        expect(tooltip()).toBeNull();
        expect(useConsole.getState().hoveredAssetCode).toBeNull();
        expect(map.canvas.style.cursor).toBe('');
      });

      it('lets go of the value when the map goes', () => {
        holdTelemetry({ 'CT-01': {} });
        const map = fakeMap();
        const { unmount } = renderTooltip(map, { assets: [asset()] });
        overAsset(map);

        unmount();

        expect(useConsole.getState().hoveredAssetCode).toBeNull();
      });
    });

    it('is not asked about while the Assets layer is hidden', () => {
      holdTelemetry({ 'CT-01': {} });
      const map = fakeMap();
      renderTooltip(map, { assets: [asset()] });
      act(() => useConsole.getState().toggleLayer('assets'));

      hover(map);

      const [, options] = map.queryRenderedFeatures.mock.lastCall as unknown as [
        unknown,
        { layers: string[] },
      ];
      expect(options.layers).not.toContain(MAP_LAYERS.assets);
    });
  });

  // V2-10.2: a layer the operator has hidden is not asked about, so it points out nothing.
  describe('layers the operator has hidden', () => {
    it('asks the map only about the layers that are shown', () => {
      const map = fakeMap();
      renderTooltip(map, { incidents: [incident()] });
      act(() => useConsole.getState().toggleLayer('incidents'));

      hover(map);

      // Incidents are hidden; the assets and the cameras are not.
      expect(map.queryRenderedFeatures).toHaveBeenLastCalledWith(
        { x: 0, y: 0 },
        { layers: [MAP_LAYERS.assets, MAP_LAYERS.cameras] },
      );
    });

    it('points out nothing, and asks nothing, when every layer it knows is hidden', () => {
      const map = fakeMap();
      renderTooltip(map, { incidents: [incident()] });
      act(() => {
        useConsole.getState().toggleLayer('incidents');
        useConsole.getState().toggleLayer('cameras');
        useConsole.getState().toggleLayer('assets');
      });

      hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

      expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
      expect(tooltip()).toBeNull();
      expect(map.canvas.style.cursor).toBe('');
    });
  });

  it('closes when the pointer leaves the map', () => {
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident()] });
    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    act(() => map.fire('mouseout'));

    expect(screen.queryByText('Door forced open')).toBeNull();
  });

  it('stays closed while the map moves', () => {
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident()] });
    const marker = hit(MAP_LAYERS.incidents, { id: 'a' });
    hover(map, marker);

    act(() => map.fire('movestart'));
    expect(tooltip()).toBeNull();

    hover(map, marker);
    expect(tooltip()).toBeNull();

    act(() => map.fire('moveend'));
    hover(map, marker);
    expect(tooltip()).not.toBeNull();
  });

  it.each([
    ['an incident it does not know', hit(MAP_LAYERS.incidents, { id: 'zz' })],
    ['a camera it does not know', hit(MAP_LAYERS.cameras, { id: 'zz' })],
    ['a hit without properties or geometry', { layer: { id: MAP_LAYERS.incidents } }],
  ])('shows nothing for %s', (_, unknownHit) => {
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident()], cameras: [camera()] });

    hover(map, unknownHit);

    expect(tooltip()).toBeNull();
  });

  it('keeps its place while the pointer stays on the same incident', () => {
    const map = fakeMap();
    map.project.mockReturnValueOnce({ x: 400, y: 300 }).mockReturnValueOnce({ x: 10, y: 10 });
    renderTooltip(map, { incidents: [incident()] });
    const marker = hit(MAP_LAYERS.incidents, { id: 'a' });

    hover(map, marker);
    hover(map, marker);

    expect(map.project).toHaveBeenCalledTimes(1);
    expect(tooltip()!.style.left).toBe('400px');
  });

  it.each([
    [20, '140px'],
    [790, '660px'],
  ])('keeps a tooltip at x=%i inside the map', (x, left) => {
    const map = fakeMap({ width: 800, at: { x, y: 300 } });
    renderTooltip(map, { incidents: [incident()] });

    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    expect(tooltip()!.style.left).toBe(left);
  });

  it('opens below a marker near the top', () => {
    const map = fakeMap({ at: { x: 400, y: 50 } });
    renderTooltip(map, { incidents: [incident()] });

    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    expect(tooltip()).toHaveAttribute('data-placement', 'below');
  });

  it('is hidden from assistive tech', () => {
    const map = fakeMap();
    renderTooltip(map, { incidents: [incident()] });

    hover(map, hit(MAP_LAYERS.incidents, { id: 'a' }));

    expect(tooltip()).toHaveAttribute('aria-hidden', 'true');
  });

  it('lets go of the map when it unmounts', () => {
    const map = fakeMap();
    const { unmount } = renderTooltip(map);
    const registered = (event: string) => map.on.mock.calls.find(([name]) => name === event)?.[1];

    unmount();

    for (const event of ['mousemove', 'mouseout', 'movestart', 'moveend']) {
      expect(map.off).toHaveBeenCalledWith(event, registered(event));
    }
  });

  it('renders nothing before the map exists', () => {
    expect(() => renderTooltip(null)).not.toThrow();
    expect(tooltip()).toBeNull();
  });
});
