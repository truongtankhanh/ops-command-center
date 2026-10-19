import type { Asset, Camera, Incident, SitePlan, TelemetryPoint, Zone } from '@occ/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeatureCollection, Geometry, Point } from 'geojson';
import { queryKeys } from '../api/queries';
import {
  type AssetProperties,
  fanOutAssets,
  incidentFeatures,
  type IncidentProperties,
} from '../lib/mapFeatures';
import { registerMapImages } from '../lib/mapImages';
import {
  cameraViewLayers,
  groundLayers,
  HOVER_LAYERS,
  INTERACTIVE_LAYERS,
  LAYER_GROUPS,
  MAP_LAYERS,
  MAP_SOURCES,
  zoneOverlayLayers,
} from '../lib/mapLayers';
import { siteBounds, type SiteProperties } from '../lib/sitePlan';
import { initialTelemetryState, type TelemetryState } from '../lib/telemetryState';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { CampusMap } from './CampusMap';

// MapLibre needs WebGL, which jsdom does not have: a fake map records what the component asks of it.
const fake = vi.hoisted(() => {
  type Handler = (event?: unknown) => void;

  class FakeSource {
    setData = vi.fn();
    getClusterExpansionZoom = vi.fn((_clusterId: number) => Promise.resolve(18));
  }

  class FakeMap {
    style: object | undefined = {};
    readonly handlers = new Map<string, Set<Handler>>();
    readonly sources = new Map<string, FakeSource>();
    readonly layers = new Set<string>();
    readonly canvas = { style: { cursor: '' } };
    /** Like a 1200 px wide map: an open sheet covers its full 440 px of it. */
    width = 1200;
    /**
     * The map's box, a real element: the map reads the sheet's inset from its computed style. In
     * the app the stage sets `--sheet-inset`; here the box holds a laptop's open-sheet value.
     */
    readonly container = document.createElement('div');
    /** What the component passed to `new Map(...)`. */
    readonly options: Record<string, unknown>;

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      this.container.style.setProperty('--sheet-inset', '440px');
      Object.defineProperty(this.container, 'clientWidth', { get: () => this.width });
      maps.push(this);
    }

    on(event: string, handler: Handler) {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(handler);
      return this;
    }
    off(event: string, handler: Handler) {
      this.handlers.get(event)?.delete(handler);
      return this;
    }
    fire(event: string, payload?: unknown) {
      this.handlers.get(event)?.forEach((handler) => handler(payload));
    }

    /** Like MapLibre: once removed, the map has no style and every style call throws. */
    private styled() {
      if (!this.style)
        throw new TypeError("Cannot read properties of undefined (reading 'getLayer')");
    }

    addSource = vi.fn((id: string) => void this.sources.set(id, new FakeSource()));
    getSource = vi.fn((id: string) => (this.styled(), this.sources.get(id)));
    removeSource = vi.fn((id: string) => (this.styled(), void this.sources.delete(id)));
    addLayer = vi.fn((layer: { id: string }, _before?: string) => void this.layers.add(layer.id));
    getLayer = vi.fn((id: string) => (this.styled(), this.layers.has(id) ? { id } : undefined));
    removeLayer = vi.fn((id: string) => (this.styled(), void this.layers.delete(id)));
    queryRenderedFeatures = vi.fn((): unknown[] => []);
    getCanvas = () => this.canvas;
    getContainer = () => this.container;
    addControl = vi.fn();
    easeTo = vi.fn();
    fitBounds = vi.fn();
    resize = vi.fn();
    setPaintProperty = vi.fn();
    setLayoutProperty = vi.fn();
    setFilter = vi.fn();
    zoomIn = vi.fn();
    zoomOut = vi.fn();
    getZoom = vi.fn(() => 16.4);
    getMinZoom = vi.fn(() => 15);
    getMaxZoom = vi.fn(() => 20);
    remove = vi.fn(() => {
      this.style = undefined;
    });
  }

  class FakeMarker {
    static created = 0;
    /** Every marker made in the current case, removed ones included. */
    static readonly instances: FakeMarker[] = [];
    private readonly element: HTMLElement;
    private readonly handlers = new Map<string, () => void>();
    private lngLat: [number, number] | undefined;
    constructor({ element }: { element: HTMLElement }) {
      FakeMarker.created += 1;
      FakeMarker.instances.push(this);
      this.element = element;
    }
    setLngLat = vi.fn((lngLat: [number, number]) => {
      this.lngLat = lngLat;
      return this;
    });
    getLngLat = () => ({ lng: this.lngLat![0], lat: this.lngLat![1] });
    setDraggable = vi.fn((_draggable: boolean) => this);
    on = (event: string, handler: () => void) => {
      this.handlers.set(event, handler);
      return this;
    };
    /** Test-only: drops the marker at `to`, as MapLibre does at the end of a drag. */
    drag(to: [number, number]) {
      this.lngLat = to;
      this.handlers.get('dragend')?.();
    }
    setOffset = () => this;
    addTo = () => {
      document.body.append(this.element);
      return this;
    };
    remove = () => {
      this.element.remove();
      return this;
    };
    getElement = () => this.element;
  }

  const maps: FakeMap[] = [];
  return { maps, FakeMap, FakeMarker };
});

vi.mock('maplibre-gl', () => ({
  default: {
    Map: fake.FakeMap,
    Marker: fake.FakeMarker,
    NavigationControl: class {},
    LngLatBounds: class {
      extend() {
        return this;
      }
    },
  },
}));

// The session module is tested on its own; a site plan that is not cached goes through the client.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

// Rasterising needs an image decoder and fonts; the images themselves are tested in mapImages.test.
vi.mock('../lib/mapImages', () => ({
  registerMapImages: vi.fn(() => Promise.resolve()),
  addClusterCountImage: vi.fn(),
}));

const POSITION: [number, number] = [108.4415, 11.953];
/** `fitBounds` padding with no sheet open: 48 px on every side. */
const FIT = { top: 48, bottom: 48, left: 48, right: 48 };

const incident = (overrides: Partial<Incident>): Incident => ({
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
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** A small building zone around `POSITION`, the zone every `incident` fixture is in. */
const zone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'z1',
  code: 'BLD-LIB',
  name: 'Library',
  kind: 'building',
  polygon: [
    [108.4412, 11.9527],
    [108.4418, 11.9527],
    [108.4418, 11.9533],
    [108.4412, 11.9533],
    [108.4412, 11.9527],
  ],
  center: POSITION,
  ...overrides,
});

/** A site whose boundary encloses the `zone` fixture. */
const SITE_PLAN: SitePlan = {
  id: 's1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: POSITION,
  features: [
    {
      part: 'boundary',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [108.441, 11.9525],
            [108.442, 11.9525],
            [108.442, 11.9535],
            [108.441, 11.9535],
            [108.441, 11.9525],
          ],
        ],
      },
    },
  ],
};

/** Renders the map with everything cached, then (unless told not to) lets it finish loading. */
async function renderMap(
  incidents: Incident[],
  {
    load = true,
    zones = [] as Zone[] | null,
    sitePlan = SITE_PLAN as SitePlan | null,
    cameras = [] as Camera[],
    assets = [] as Asset[],
  }: {
    load?: boolean;
    zones?: Zone[] | null;
    sitePlan?: SitePlan | null;
    cameras?: Camera[];
    assets?: Asset[];
  } = {},
) {
  const client = createTestQueryClient();
  // `null`: not cached, so the map asks the API for the zones.
  if (zones) client.setQueryData(queryKeys.zones, zones);
  // `null`: not cached, so the map asks the API for it.
  if (sitePlan) client.setQueryData(queryKeys.sitePlan, sitePlan);
  client.setQueryData(queryKeys.cameras, cameras);
  client.setQueryData(queryKeys.assets, assets);
  client.setQueryData(queryKeys.incidents, incidents);
  const view = renderWithQueryClient(<CampusMap />, client);
  const map = fake.maps.at(-1)!;
  if (load) await act(async () => map.fire('load'));
  return { ...view, map };
}

/** The data last set on a source. */
function lastData(map: InstanceType<typeof fake.FakeMap>, source: string) {
  const call = map.sources.get(source)!.setData.mock.lastCall;
  return call![0] as FeatureCollection<Point, IncidentProperties>;
}

const ids = (data: FeatureCollection<Point, IncidentProperties>) =>
  data.features.map((feature) => feature.properties.id);

/** The parts on the site source as it was last added. */
function siteParts(map: InstanceType<typeof fake.FakeMap>) {
  const [, source] = map.addSource.mock.calls
    .filter(([id]) => id === MAP_SOURCES.site)
    .at(-1) as unknown as [string, { data: FeatureCollection<Geometry, SiteProperties> }];
  return source.data.features.map((feature) => feature.properties.part);
}

/** `GET /api/site-plan` with no site set up — also what an API from before the route answers. */
function siteNotFound() {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ statusCode: 404, message: 'Site plan was not found' }), {
        status: 404,
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * `GET /api/zones` answers in turn, one factory each (a request stays pending once they are used
 * up); any other request is a 404.
 */
function zonesApi(...answers: (() => Response)[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (String(input).endsWith('/zones')) {
      const answer = answers.shift();
      return answer ? Promise.resolve(answer()) : new Promise<Response>(() => {});
    }
    return Promise.resolve(
      new Response(JSON.stringify({ statusCode: 404, message: 'Not found' }), { status: 404 }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const zoneCalls = (fetchMock: ReturnType<typeof zonesApi>) =>
  fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/zones'));

/** What adding, as opposed to updating, has cost so far. */
const creations = (map: InstanceType<typeof fake.FakeMap>) => ({
  sources: map.addSource.mock.calls.length,
  layers: map.addLayer.mock.calls.length,
  markers: fake.FakeMarker.created,
});

function click(map: InstanceType<typeof fake.FakeMap>, hit: unknown) {
  map.queryRenderedFeatures.mockReturnValueOnce(hit ? [hit] : []);
  map.fire('click', { point: { x: 0, y: 0 } });
}

/** A click at a map position, as the report's pin is placed. */
function clickAt(map: InstanceType<typeof fake.FakeMap>, [lng, lat]: [number, number]) {
  map.fire('click', { point: { x: 0, y: 0 }, lngLat: { lng, lat } });
}

describe('CampusMap', () => {
  beforeEach(() => {
    resetStore(useConsole);
    fake.maps.length = 0;
    fake.FakeMarker.created = 0;
    fake.FakeMarker.instances.length = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('adds no layer before the map has loaded its marker images', async () => {
    const { map } = await renderMap([incident({})], { load: false });

    expect(map.addSource).not.toHaveBeenCalled();
  });

  it('draws incidents and cameras as layers once the map has loaded', async () => {
    const { map } = await renderMap([incident({ id: 'a' })]);

    expect(map.addSource.mock.calls.map(([id]) => id)).toEqual([
      MAP_SOURCES.cameraViews,
      MAP_SOURCES.cameras,
      MAP_SOURCES.assets,
      MAP_SOURCES.incidents,
      MAP_SOURCES.selected,
    ]);
    expect(map.layers).toContain(MAP_LAYERS.incidents);
    expect(ids(lastData(map, MAP_SOURCES.incidents))).toEqual(['a']);
  });

  it('draws the cluster severity badge over the cluster count, as a label only', async () => {
    const { map } = await renderMap([incident({ id: 'a' })]);
    const added = map.addLayer.mock.calls.map(([layer]) => layer.id);

    expect(map.layers).toContain(MAP_LAYERS.clusterSeverity);
    expect(added.indexOf(MAP_LAYERS.clusterSeverity)).toBeGreaterThan(
      added.indexOf(MAP_LAYERS.clusterCount),
    );
    expect(INTERACTIVE_LAYERS).not.toContain(MAP_LAYERS.clusterSeverity);
  });

  it('updates the incident source in place on an incident event', async () => {
    const { map, client } = await renderMap([incident({ id: 'a' })]);
    const before = creations(map);

    // What `useLiveIncidents` does on `incident.created`. The query notifies its observers on a
    // later tick, so wait for the map to pick it up.
    act(() =>
      client.setQueryData(queryKeys.incidents, [
        incident({ id: 'a' }),
        incident({ id: 'b', severity: 'low', reportedAt: '2026-10-01T08:05:00.000Z' }),
      ]),
    );

    await waitFor(() =>
      expect(ids(lastData(map, MAP_SOURCES.incidents)).sort()).toEqual(['a', 'b']),
    );
    expect(creations(map)).toEqual(before);
  });

  it('moves the selected incident to its own source and tags it, without rebuilding', async () => {
    const { map } = await renderMap([
      incident({ id: 'a' }),
      incident({ id: 'b', code: 'INC-000002' }),
    ]);
    const before = creations(map);

    act(() => useConsole.getState().select('b'));

    expect(ids(lastData(map, MAP_SOURCES.incidents))).toEqual(['a']);
    expect(ids(lastData(map, MAP_SOURCES.selected))).toEqual(['b']);
    expect(document.body).toHaveTextContent('INC-000002');
    expect(creations(map)).toEqual(before);

    act(() => useConsole.getState().select(null));

    expect(ids(lastData(map, MAP_SOURCES.selected))).toEqual([]);
    expect(document.body).not.toHaveTextContent('INC-000002');
  });

  it('keeps incidents at the same spot apart and selectable one by one', async () => {
    const { map } = await renderMap([
      incident({ id: 'a', reportedAt: '2026-10-01T08:00:00.000Z' }),
      incident({ id: 'b', reportedAt: '2026-10-01T08:01:00.000Z' }),
    ]);
    const [first, second] = lastData(map, MAP_SOURCES.incidents).features;
    expect(first!.geometry.coordinates).not.toEqual(second!.geometry.coordinates);

    act(() => click(map, { layer: { id: MAP_LAYERS.incidents }, properties: { id: 'b' } }));
    expect(useConsole.getState().selectedIncidentId).toBe('b');

    act(() => click(map, { layer: { id: MAP_LAYERS.incidents }, properties: { id: 'a' } }));
    expect(useConsole.getState().selectedIncidentId).toBe('a');
  });

  it('clears the selection when the selected marker is clicked again', async () => {
    const { map } = await renderMap([incident({ id: 'a' })]);
    act(() => useConsole.getState().select('a'));

    act(() => click(map, { layer: { id: MAP_LAYERS.selected }, properties: { id: 'a' } }));

    expect(useConsole.getState().selectedIncidentId).toBeNull();
  });

  it('ignores a click on empty ground', async () => {
    const { map } = await renderMap([incident({ id: 'a' })]);
    act(() => useConsole.getState().select('a'));

    act(() => click(map, null));

    expect(useConsole.getState().selectedIncidentId).toBe('a');
  });

  it('opens a camera in the viewer and keeps the selected incident', async () => {
    const { map } = await renderMap([incident({ id: 'a' })]);
    act(() => useConsole.getState().select('a'));

    act(() => click(map, { layer: { id: MAP_LAYERS.cameras }, properties: { id: 'c1' } }));

    expect(useConsole.getState()).toMatchObject({ viewerCameraId: 'c1', selectedIncidentId: 'a' });
  });

  it('zooms into a cluster where it breaks up', async () => {
    const { map } = await renderMap([incident({ id: 'a' })]);
    map.easeTo.mockClear();

    await act(async () =>
      click(map, {
        layer: { id: MAP_LAYERS.clusters },
        properties: { cluster_id: 7 },
        geometry: { type: 'Point', coordinates: POSITION },
      }),
    );

    expect(map.sources.get(MAP_SOURCES.incidents)!.getClusterExpansionZoom).toHaveBeenCalledWith(7);
    expect(map.easeTo).toHaveBeenCalledWith({ center: POSITION, zoom: 18 });
    expect(useConsole.getState().selectedIncidentId).toBeNull();
  });

  it('shows a pointer over a marker', async () => {
    const { map } = await renderMap([incident({ id: 'a' })]);

    map.queryRenderedFeatures.mockReturnValueOnce([{ layer: { id: MAP_LAYERS.incidents } }]);
    map.fire('mousemove', { point: { x: 0, y: 0 } });
    expect(map.canvas.style.cursor).toBe('pointer');

    map.fire('mousemove', { point: { x: 0, y: 0 } });
    expect(map.canvas.style.cursor).toBe('');
  });

  it('stays without layers when the marker images fail to load', async () => {
    vi.mocked(registerMapImages).mockRejectedValueOnce(new Error('decode failed'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { map } = await renderMap([incident({ id: 'a' })]);

    expect(map.addSource).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith('Map images failed to load', expect.any(Error));
    logged.mockRestore();
  });

  it('removes the map on unmount without touching its layers afterwards', async () => {
    const { map, unmount } = await renderMap([incident({ id: 'a' })]);

    expect(() => unmount()).not.toThrow();

    expect(map.remove).toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  // V2-10.4: an asset on the map selects, rings and is followed, as an incident is.
  describe('asset interaction', () => {
    const oneAsset = (overrides: Partial<Asset> = {}): Asset => ({
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
      headline: [],
      ...overrides,
    });
    const assetHit = (code: unknown) => ({
      layer: { id: MAP_LAYERS.assets },
      properties: { code },
    });
    const ringCalls = (map: InstanceType<typeof fake.FakeMap>, layer: string) =>
      map.setFilter.mock.calls.filter(([id]) => id === layer);
    const campus = () => siteBounds(SITE_PLAN, [zone()]);

    beforeEach(() => resetStore(useTelemetryStore));

    it('selects an asset on a click, and deselects it on a second click', async () => {
      const { map } = await renderMap([], { assets: [oneAsset()] });

      click(map, assetHit('CT-01'));
      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');

      click(map, assetHit('CT-01'));
      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    // V2-15.2: the click also says which building to focus, for the 3D view; the map itself ignores it.
    it('focuses the building of the asset it selects', async () => {
      const { map } = await renderMap([], { assets: [oneAsset()], zones: [zone()] });

      click(map, assetHit('CT-01'));

      expect(useConsole.getState().focusZoneId).toBe('z1');
    });

    it('focuses nothing for an asset in a zone that is not a building', async () => {
      const plant = zone({ id: 'z2', code: 'UTL-PLANT', name: 'Utility Plant', kind: 'utility' });
      const { map } = await renderMap([], {
        assets: [oneAsset({ zoneId: 'z2' })],
        zones: [zone(), plant],
      });
      useConsole.setState({ focusZoneId: 'z1' });

      click(map, assetHit('CT-01'));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(useConsole.getState().focusZoneId).toBeNull();
    });

    it('keeps the building in focus when a second click deselects the asset', async () => {
      const { map } = await renderMap([], { assets: [oneAsset()], zones: [zone()] });
      click(map, assetHit('CT-01'));

      click(map, assetHit('CT-01'));

      expect(useConsole.getState().selectedAssetCode).toBeNull();
      expect(useConsole.getState().focusZoneId).toBe('z1');
    });

    it('opens the incident drawn over an asset, not the asset', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { assets: [oneAsset()] });
      // The map answers topmost first: the incident marker, then the asset beneath it.
      map.queryRenderedFeatures.mockReturnValueOnce([
        { layer: { id: MAP_LAYERS.incidents }, properties: { id: 'a' } },
        assetHit('CT-01'),
      ]);

      map.fire('click', { point: { x: 0, y: 0 } });

      expect(useConsole.getState().selectedIncidentId).toBe('a');
      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    it('does not read a hit without a code as an incident', async () => {
      const { map } = await renderMap([], { assets: [oneAsset()] });

      click(map, assetHit(undefined));

      expect(useConsole.getState().selectedAssetCode).toBeNull();
      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('hits nothing, and keeps the crosshair, while the report location is picked', async () => {
      const { map } = await renderMap([], { assets: [oneAsset()] });
      act(() => useConsole.getState().setPicking(true));
      map.queryRenderedFeatures.mockClear();
      map.queryRenderedFeatures.mockReturnValueOnce([assetHit('CT-01')]);

      // A click while picking places the report's pin, which reads where the pointer is.
      clickAt(map, POSITION);

      expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
      expect(useConsole.getState().selectedAssetCode).toBeNull();
      expect(map.canvas.style.cursor).toBe('crosshair');
    });

    describe('the rings', () => {
      it('set no filter before an asset is hovered or selected', async () => {
        const { map } = await renderMap([], { assets: [oneAsset()] });

        expect(ringCalls(map, MAP_LAYERS.assetSelected)).toEqual([]);
        expect(ringCalls(map, MAP_LAYERS.assetHover)).toEqual([]);
      });

      it('ring the selected asset, and none once it is deselected', async () => {
        const { map } = await renderMap([], { assets: [oneAsset()] });

        act(() => useConsole.getState().selectAsset('CT-01', null));
        expect(map.setFilter).toHaveBeenLastCalledWith(MAP_LAYERS.assetSelected, [
          '==',
          ['get', 'code'],
          'CT-01',
        ]);

        act(() => useConsole.getState().selectAsset(null));
        expect(map.setFilter).toHaveBeenLastCalledWith(MAP_LAYERS.assetSelected, false);
      });

      it('ring the asset a row of the list is hovered on, and let go of it', async () => {
        const { map } = await renderMap([], { assets: [oneAsset()] });

        act(() => useConsole.getState().hoverAsset('CT-01'));
        expect(map.setFilter).toHaveBeenLastCalledWith(MAP_LAYERS.assetHover, [
          '==',
          ['get', 'code'],
          'CT-01',
        ]);

        act(() => useConsole.getState().hoverAsset(null));
        expect(map.setFilter).toHaveBeenLastCalledWith(MAP_LAYERS.assetHover, false);
      });

      it('touch a filter only when its asset changes', async () => {
        const { map } = await renderMap([], { assets: [oneAsset()] });

        act(() => useConsole.getState().hoverAsset('CT-01'));
        act(() => useConsole.getState().hoverAsset('CT-01'));
        act(() => useConsole.getState().setAssetFilter('faults'));

        expect(ringCalls(map, MAP_LAYERS.assetHover)).toHaveLength(1);
        expect(ringCalls(map, MAP_LAYERS.assetSelected)).toHaveLength(0);
      });

      it('go with the Assets layer, and selecting an asset shows the layer again', async () => {
        const { map } = await renderMap([], { assets: [oneAsset()] });
        act(() => useConsole.getState().toggleLayer('assets'));
        expect(
          map.setLayoutProperty.mock.calls
            .filter(([, , value]) => value === 'none')
            .map(([id]) => id),
        ).toEqual(expect.arrayContaining([MAP_LAYERS.assetHover, MAP_LAYERS.assetSelected]));
        map.setLayoutProperty.mockClear();

        act(() => useConsole.getState().selectAsset('CT-01', null));

        expect(map.setLayoutProperty.mock.calls.map(([id, , value]) => [id, value])).toEqual(
          expect.arrayContaining([[MAP_LAYERS.assetSelected, 'visible']]),
        );
      });

      it('let go of the store when the map goes', async () => {
        const { map, unmount } = await renderMap([], { assets: [oneAsset()] });
        const before = map.setFilter.mock.calls.length;

        unmount();
        act(() => useConsole.getState().selectAsset('CT-01', null));

        expect(map.setFilter.mock.calls.length).toBe(before);
      });
    });

    describe('the view', () => {
      it('centres the selected asset beside the open sheet and returns to the campus on close', async () => {
        const { map } = await renderMap([], { zones: [zone()], assets: [oneAsset()] });

        act(() => useConsole.getState().selectAsset('CT-01', null));
        expect(map.easeTo).toHaveBeenLastCalledWith({
          center: POSITION,
          offset: [-220, 0],
          duration: 600,
        });

        act(() => useConsole.getState().selectAsset(null));
        expect(map.fitBounds).toHaveBeenLastCalledWith(campus(), { padding: FIT, duration: 600 });
      });

      it('centres the marker as drawn when assets stand on one point', async () => {
        const pair = [
          oneAsset({ id: 'p', code: 'PMP-S1', name: 'Booster pump' }),
          oneAsset({ id: 'i', code: 'ICS-STU', name: 'Student Center sensor' }),
        ];
        const { map } = await renderMap([], { zones: [zone()], assets: pair });

        act(() => useConsole.getState().selectAsset('PMP-S1', null));

        const drawn = fanOutAssets(pair).get('PMP-S1')!;
        expect(drawn).not.toEqual(POSITION);
        expect(map.easeTo).toHaveBeenLastCalledWith({
          center: drawn,
          offset: [-220, 0],
          duration: 600,
        });
      });

      it('moves to another asset, then to an incident when one takes the sheet', async () => {
        const other = oneAsset({ id: 'b', code: 'CT-02', position: [108.4416, 11.953] });
        const raised: [number, number] = [108.4413, 11.9528];
        const { map } = await renderMap([incident({ id: 'a', position: raised })], {
          zones: [zone()],
          assets: [oneAsset(), other],
        });
        act(() => useConsole.getState().selectAsset('CT-01', null));

        act(() => useConsole.getState().selectAsset('CT-02', null));
        expect(map.easeTo).toHaveBeenLastCalledWith({
          center: [108.4416, 11.953],
          offset: [-220, 0],
          duration: 600,
        });

        // An incident takes the sheet: the asset stops being the subject of the view.
        act(() => useConsole.getState().select('a'));
        expect(map.easeTo).toHaveBeenLastCalledWith({
          center: raised,
          offset: [-220, 0],
          duration: 600,
        });
      });

      it('jumps, instead of easing, when the operator prefers reduced motion', async () => {
        vi.stubGlobal(
          'matchMedia',
          vi.fn(() => ({
            matches: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          })),
        );
        const { map } = await renderMap([], { zones: [zone()], assets: [oneAsset()] });

        act(() => useConsole.getState().selectAsset('CT-01', null));
        expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 0 }));

        act(() => useConsole.getState().selectAsset(null));
        expect(map.fitBounds).toHaveBeenLastCalledWith(
          campus(),
          expect.objectContaining({ duration: 0 }),
        );
      });
    });
  });

  // V2-10.2: the operator's "Show" toggles hide a kind of marker, and only that. What is hidden
  // cannot be hit, and the DOM tag of the selected incident goes with its layers.
  describe('layer toggles', () => {
    const fired = (map: InstanceType<typeof fake.FakeMap>) =>
      map.setLayoutProperty.mock.calls as [string, string, string][];
    const idsSet = (map: InstanceType<typeof fake.FakeMap>, visibility: string) =>
      fired(map)
        .filter(([, , value]) => value === visibility)
        .map(([id]) => id);

    it('touches no layer while everything is shown', async () => {
      const { map } = await renderMap([incident({ id: 'a' })]);

      expect(map.setLayoutProperty).not.toHaveBeenCalled();
    });

    it('hides the incident layers together and no others', async () => {
      const { map } = await renderMap([incident({ id: 'a' })]);

      act(() => useConsole.getState().toggleLayer('incidents'));

      expect(idsSet(map, 'none').sort()).toEqual([...LAYER_GROUPS.incidents].sort());
      expect(fired(map).every(([, property]) => property === 'visibility')).toBe(true);
    });

    it('shows them again, and only them', async () => {
      const { map } = await renderMap([incident({ id: 'a' })]);
      act(() => useConsole.getState().toggleLayer('incidents'));
      map.setLayoutProperty.mockClear();

      act(() => useConsole.getState().toggleLayer('incidents'));

      expect(idsSet(map, 'visible').sort()).toEqual([...LAYER_GROUPS.incidents].sort());
      expect(idsSet(map, 'none')).toEqual([]);
    });

    it('hides a camera marker together with its view', async () => {
      const { map } = await renderMap([], { cameras: [] });

      act(() => useConsole.getState().toggleLayer('cameras'));

      expect(idsSet(map, 'none').sort()).toEqual([...LAYER_GROUPS.cameras].sort());
      expect(idsSet(map, 'none')).toEqual(
        expect.arrayContaining([MAP_LAYERS.cameras, MAP_LAYERS.cameraViewFill]),
      );
    });

    it('hides the asset layer alone', async () => {
      const { map } = await renderMap([]);

      act(() => useConsole.getState().toggleLayer('assets'));

      // The marker and its two rings (V2-10.4) are one group.
      expect(idsSet(map, 'none').sort()).toEqual([...LAYER_GROUPS.assets].sort());
      expect(idsSet(map, 'none')).toEqual(
        expect.arrayContaining([MAP_LAYERS.assets, MAP_LAYERS.assetSelected]),
      );
    });

    it('never hides the ground, the zone outline or highlight', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });

      for (const key of ['incidents', 'cameras', 'assets'] as const) {
        act(() => useConsole.getState().toggleLayer(key));
      }

      const touched = fired(map).map(([id]) => id);
      for (const id of [
        ...groundLayers(0).map((l) => l.id),
        MAP_LAYERS.zoneOutline,
        MAP_LAYERS.zoneHighlight,
      ]) {
        expect(touched).not.toContain(id);
      }
    });

    it('applies a toggle made before the map had loaded, once the layers exist', async () => {
      useConsole.getState().toggleLayer('cameras');

      const { map } = await renderMap([incident({ id: 'a' })]);

      expect(idsSet(map, 'none').sort()).toEqual([...LAYER_GROUPS.cameras].sort());
    });

    it('asks the map only about the layers that are shown when a marker is clicked', async () => {
      const { map } = await renderMap([incident({ id: 'a' })]);
      act(() => useConsole.getState().toggleLayer('incidents'));

      click(map, null);

      // Incidents are hidden; the assets and the cameras are not.
      expect(map.queryRenderedFeatures).toHaveBeenLastCalledWith(
        { x: 0, y: 0 },
        { layers: [MAP_LAYERS.assets, MAP_LAYERS.cameras] },
      );
    });

    it('selects nothing and asks nothing when every clickable layer is hidden', async () => {
      const { map } = await renderMap([incident({ id: 'a' })]);
      act(() => {
        useConsole.getState().toggleLayer('incidents');
        useConsole.getState().toggleLayer('cameras');
        useConsole.getState().toggleLayer('assets');
      });
      map.queryRenderedFeatures.mockClear();

      click(map, { layer: { id: MAP_LAYERS.incidents }, properties: { id: 'a' } });

      expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('takes the selected incident’s code tag away with the incidents, and brings it back', async () => {
      const { map } = await renderMap([incident({ id: 'a', code: 'INC-000007' })]);
      act(() => useConsole.getState().select('a'));
      expect(document.body).toHaveTextContent('INC-000007');

      act(() => useConsole.getState().toggleLayer('incidents'));
      expect(document.body).not.toHaveTextContent('INC-000007');

      act(() => useConsole.getState().showLayer('incidents'));
      expect(document.body).toHaveTextContent('INC-000007');
      expect(map.layers).toContain(MAP_LAYERS.incidents);
    });

    it('selecting an incident shows the hidden incidents layer again', async () => {
      const { map } = await renderMap([incident({ id: 'a' })]);
      act(() => useConsole.getState().toggleLayer('incidents'));
      map.setLayoutProperty.mockClear();

      act(() => useConsole.getState().select('a'));

      expect(idsSet(map, 'visible').sort()).toEqual([...LAYER_GROUPS.incidents].sort());
    });
  });

  // V2-10.3: the equipment, drawn under the incidents and over the cameras, from the catalogue and
  // the telemetry the console holds.
  describe('assets', () => {
    const NOW = Date.parse('2026-10-15T08:00:00.000Z');
    const RECEIVED = new Date(NOW).toISOString();
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
    /** Stale after the 5 s floor; a class with no state point is Running while nothing is wrong. */
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
      headline: [point('fanSpeedRpm', 1)],
      ...overrides,
    });

    /** The API's clock anchored at `NOW` at monotonic time 1000, and what each asset last sent. */
    const telemetry = (
      assets: Record<string, { online?: boolean; receivedAt?: string; rpm?: number }>,
    ): TelemetryState => ({
      ...initialTelemetryState,
      serverClock: { at: NOW, mono: 1000 },
      assets: Object.fromEntries(
        Object.entries(assets).map(
          ([code, { online = true, receivedAt = RECEIVED, rpm = 1200 }]) => [
            code,
            {
              online,
              receivedAt,
              headline: { fanSpeedRpm: rpm },
              values: { fanSpeedRpm: rpm },
              keyReceivedAt: { fanSpeedRpm: receivedAt },
            },
          ],
        ),
      ),
    });
    const setTelemetry = (state: TelemetryState) =>
      act(() => useTelemetryStore.setState({ view: { state, series: new Map() } }));

    const data = (map: InstanceType<typeof fake.FakeMap>) =>
      lastData(map, MAP_SOURCES.assets) as unknown as FeatureCollection<Point, AssetProperties>;
    const setDataCalls = (map: InstanceType<typeof fake.FakeMap>) =>
      map.sources.get(MAP_SOURCES.assets)!.setData.mock.calls.length;
    const images = (map: InstanceType<typeof fake.FakeMap>) =>
      data(map).features.map((f) => f.properties.image);

    beforeEach(() => {
      resetStore(useTelemetryStore);
      // The clock the map reads, and the only timer it uses, are the two this block controls.
      vi.spyOn(performance, 'now').mockReturnValue(1000);
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('adds the layer after the cameras and before the incidents', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { assets: [asset()] });

      const order = map.addLayer.mock.calls.map(([layer]) => layer.id);
      expect(order.indexOf(MAP_LAYERS.assets)).toBeGreaterThan(order.indexOf(MAP_LAYERS.cameras));
      expect(order.indexOf(MAP_LAYERS.assets)).toBeLessThan(order.indexOf(MAP_LAYERS.pulseStatic));
      expect(order.indexOf(MAP_LAYERS.assets)).toBeLessThan(order.indexOf(MAP_LAYERS.incidents));
    });

    // V2-10.4: an asset is hit after the incident layers and the clusters, so what is drawn over it
    // wins a click, and before the cameras it is drawn over. The rings take no pointer event.
    it('is a layer a click and a hover act on, below the incidents and above the cameras', () => {
      const lists: (readonly string[])[] = [INTERACTIVE_LAYERS, HOVER_LAYERS];
      for (const list of lists) {
        const at = (id: string) => list.indexOf(id);
        expect(at(MAP_LAYERS.assets)).toBeGreaterThan(at(MAP_LAYERS.incidents));
        expect(at(MAP_LAYERS.assets)).toBeGreaterThan(at(MAP_LAYERS.clusters));
        expect(at(MAP_LAYERS.assets)).toBeLessThan(at(MAP_LAYERS.cameras));
        expect(list).not.toContain(MAP_LAYERS.assetHover);
        expect(list).not.toContain(MAP_LAYERS.assetSelected);
      }
    });

    it('draws each asset at its own position, `GEN-01` outside its zone included', async () => {
      const outside: [number, number] = [POSITION[0] + 0.0002, POSITION[1]];
      const { map } = await renderMap([], {
        assets: [
          asset({ id: 'a', code: 'CT-01' }),
          asset({ id: 'g', code: 'GEN-01', position: outside }),
        ],
      });

      const features = data(map).features;
      expect(features.map((f) => f.properties.code)).toEqual(['CT-01', 'GEN-01']);
      expect(features[0]!.geometry.coordinates).toEqual(POSITION);
      expect(features[1]!.geometry.coordinates).toEqual(outside);
    });

    it('keeps two assets on one point apart, so each can be picked', async () => {
      const { map } = await renderMap([], {
        assets: [asset({ id: 'p', code: 'PMP-S1' }), asset({ id: 'i', code: 'ICS-STU' })],
      });

      const [first, second] = data(map).features.map((f) => f.geometry.coordinates);
      expect(first).not.toEqual(second);
    });

    it('draws an empty catalogue as no markers', async () => {
      const { map } = await renderMap([], { assets: [] });

      expect(data(map).features).toEqual([]);
    });

    it('draws a fault in the severity of its incident, even when its reading is old', async () => {
      await setTelemetry(
        telemetry({ 'CT-01': { receivedAt: new Date(NOW - 600_000).toISOString() } }),
      );

      const { map } = await renderMap(
        [incident({ id: 'inc', assetId: 'asset-ct-01', severity: 'critical' })],
        { assets: [asset()] },
      );

      expect(images(map)).toEqual(['asset-fault-critical']);
    });

    it('updates one marker, not the layers, when an asset goes offline and comes back', async () => {
      await setTelemetry(telemetry({ 'CT-01': {}, 'CT-02': {} }));
      const { map } = await renderMap([], {
        assets: [
          asset(),
          asset({ id: 'asset-ct-02', code: 'CT-02', position: [108.4416, 11.953] }),
        ],
      });
      expect(images(map)).toEqual(['asset-normal', 'asset-normal']);
      const built = creations(map);

      await setTelemetry(telemetry({ 'CT-01': { online: false }, 'CT-02': {} }));
      expect(images(map)).toEqual(['asset-nodata', 'asset-normal']);

      await setTelemetry(telemetry({ 'CT-01': {}, 'CT-02': {} }));
      expect(images(map)).toEqual(['asset-normal', 'asset-normal']);
      expect(creations(map)).toEqual(built);
    });

    it('sends nothing for a reading that changes no state, on telemetry or on the timer', async () => {
      await setTelemetry(telemetry({ 'CT-01': { rpm: 1200 } }));
      const { map } = await renderMap([], { assets: [asset()] });
      const sent = setDataCalls(map);

      await setTelemetry(telemetry({ 'CT-01': { rpm: 1250 } }));
      await setTelemetry(telemetry({ 'CT-01': { rpm: 1300 } }));
      act(() => vi.advanceTimersByTime(3000));

      expect(setDataCalls(map)).toBe(sent);
    });

    it('marks an asset as no data when its reading ages past its threshold with no traffic', async () => {
      await setTelemetry(telemetry({ 'CT-01': {} }));
      const { map } = await renderMap([], { assets: [asset()] });
      expect(images(map)).toEqual(['asset-normal']);

      // Nothing arrives; the API's clock moves on (the 5 s floor is long past).
      vi.mocked(performance.now).mockReturnValue(1000 + 60_000);
      act(() => vi.advanceTimersByTime(1000));

      expect(images(map)).toEqual(['asset-nodata']);
    });

    it('stops listening and ticking when the map goes', async () => {
      await setTelemetry(telemetry({ 'CT-01': {} }));
      const { map, unmount } = await renderMap([], { assets: [asset()] });
      const sent = setDataCalls(map);

      unmount();
      await setTelemetry(telemetry({ 'CT-01': { online: false } }));
      act(() => vi.advanceTimersByTime(3000));

      expect(setDataCalls(map)).toBe(sent);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // The zones are the campus: without them the map is an empty ground, so it says why (UI-15).
  describe('zones loading', () => {
    it('says the map is loading until the zones arrive', async () => {
      zonesApi();

      await renderMap([], { zones: null });

      expect(screen.getByText('Loading the campus map…')).toHaveAttribute('role', 'status');
      expect(screen.getByRole('region', { name: 'Campus map' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });

    it('says the map could not be loaded, and retries', async () => {
      const fetchMock = zonesApi(
        () =>
          new Response(JSON.stringify({ statusCode: 500, message: 'Internal server error' }), {
            status: 500,
          }),
        () => new Response(JSON.stringify([zone()]), { status: 200 }),
      );
      await renderMap([], { zones: null });

      expect(await screen.findByText('The campus map could not be loaded.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      await waitFor(() =>
        expect(screen.queryByText('The campus map could not be loaded.')).toBeNull(),
      );
      expect(zoneCalls(fetchMock)).toHaveLength(2);
      expect(screen.getByRole('region', { name: 'Campus map' })).not.toHaveAttribute('aria-busy');
    });
  });

  describe('site plan', () => {
    const groundLayerIds = groundLayers(0).map((layer) => layer.id);
    const siteLayerIds = [...groundLayerIds, ...zoneOverlayLayers().map((layer) => layer.id)];
    const highlightOf = (zoneId: string) => ['==', ['get', 'id'], zoneId];

    it('draws the site plan and zones under the markers once loaded', async () => {
      const { map } = await renderMap([incident({})], { zones: [zone()] });

      expect(map.addSource.mock.calls.map(([id]) => id)).toEqual([
        MAP_SOURCES.site,
        MAP_SOURCES.zones,
        MAP_SOURCES.cameraViews,
        MAP_SOURCES.cameras,
        MAP_SOURCES.assets,
        MAP_SOURCES.incidents,
        MAP_SOURCES.selected,
      ]);
      const firstLayers = map.addLayer.mock.calls.slice(0, siteLayerIds.length);
      expect(firstLayers.map(([layer]) => layer.id)).toEqual(siteLayerIds);
    });

    it('keeps late zones under the cameras', async () => {
      const { map, client } = await renderMap([incident({})]);

      act(() => client.setQueryData(queryKeys.zones, [zone()]));

      await waitFor(() =>
        expect(map.addSource).toHaveBeenCalledWith(MAP_SOURCES.site, expect.anything()),
      );
      const siteCalls = map.addLayer.mock.calls.filter(([layer]) =>
        siteLayerIds.includes(layer.id),
      );
      expect(siteCalls).toHaveLength(siteLayerIds.length);
      // The ground under the camera views, the zone outline and highlight over them.
      for (const [layer, before] of siteCalls) {
        expect(before).toBe(
          groundLayerIds.includes(layer.id) ? MAP_LAYERS.cameraViewFill : MAP_LAYERS.cameras,
        );
      }
    });

    it('fits the whole campus, boundary included', async () => {
      const { map } = await renderMap([incident({})], { zones: [zone()] });

      expect(map.fitBounds).toHaveBeenCalledWith(siteBounds(SITE_PLAN, [zone()]), {
        padding: FIT,
        duration: 0,
      });
    });

    it('labels each zone', async () => {
      await renderMap([incident({})], { zones: [zone()] });

      // Zone labels are DOM markers: the offline style has no glyphs for map text.
      expect(document.body).toHaveTextContent('Library');
    });

    it('hides the zone labels from assistive tech', async () => {
      await renderMap([incident({})], { zones: [zone()] });

      // Pointer-only, like the map: MapLibre would otherwise make each one a "Map marker" button.
      const label = fake.FakeMarker.instances.find(
        (marker) => marker.getElement().textContent === 'Library',
      );
      expect(label!.getElement()).toHaveAttribute('aria-hidden', 'true');
    });

    it("outlines the selected incident's zone", async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });

      act(() => useConsole.getState().select('a'));
      expect(map.setFilter).toHaveBeenLastCalledWith(MAP_LAYERS.zoneHighlight, highlightOf('z1'));

      act(() => useConsole.getState().select(null));
      expect(map.setFilter).toHaveBeenLastCalledWith(MAP_LAYERS.zoneHighlight, false);
    });

    it('outlines the zone once it arrives after the selection', async () => {
      const { map, client } = await renderMap([incident({ id: 'a' })]);
      act(() => useConsole.getState().select('a'));
      expect(map.setFilter).not.toHaveBeenCalled();

      act(() => client.setQueryData(queryKeys.zones, [zone()]));

      await waitFor(() =>
        expect(map.setFilter).toHaveBeenCalledWith(MAP_LAYERS.zoneHighlight, highlightOf('z1')),
      );
    });

    it('outlines the zone being reported', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });

      act(() => {
        useConsole.getState().startReport();
        useConsole.getState().setReportZone('z1');
      });
      expect(map.setFilter).toHaveBeenLastCalledWith(MAP_LAYERS.zoneHighlight, highlightOf('z1'));

      act(() => useConsole.getState().closeReport());
      expect(map.setFilter).toHaveBeenLastCalledWith(MAP_LAYERS.zoneHighlight, false);
    });

    it('unmounts with zones drawn without touching the removed map', async () => {
      const { map, unmount } = await renderMap([incident({})], { zones: [zone()] });

      expect(() => unmount()).not.toThrow();

      expect(map.remove).toHaveBeenCalled();
      expect(map.removeLayer).not.toHaveBeenCalled();
      expect(map.removeSource).not.toHaveBeenCalled();
    });

    it('opens with the zoom limits and no fixed centre', async () => {
      const { map } = await renderMap([]);

      // Where the site is comes from data; the map is framed when it arrives.
      expect(map.options).toMatchObject({ minZoom: 15, maxZoom: 20 });
      expect(map.options).not.toHaveProperty('center');
      // The themed controls replace MapLibre's own.
      expect(map.addControl).not.toHaveBeenCalled();
    });

    it('offers the map controls and the legend', async () => {
      const { map } = await renderMap([incident({})], { zones: [zone()] });
      expect(screen.getByRole('group', { name: 'Map view' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
      map.fitBounds.mockClear();

      await userEvent.click(screen.getByRole('button', { name: 'Fit campus' }));

      expect(map.fitBounds).toHaveBeenCalledWith(siteBounds(SITE_PLAN, [zone()]), {
        padding: FIT,
        duration: 600,
      });
    });

    describe('without a site plan', () => {
      it('draws the zones alone and frames them when the API has no site plan', async () => {
        const fetchMock = siteNotFound();
        const { map, client } = await renderMap([incident({})], {
          zones: [zone()],
          sitePlan: null,
        });

        await waitFor(() => expect(client.getQueryState(queryKeys.sitePlan)?.status).toBe('error'));
        expect(fetchMock).toHaveBeenCalledWith('/api/site-plan', expect.anything());
        expect(siteParts(map)).toEqual(['footprint']);
        expect(map.fitBounds).toHaveBeenCalledWith(siteBounds(undefined, [zone()]), {
          padding: FIT,
          duration: 0,
        });
        // No error on the map: the plan is decoration.
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });

      it('adds the site plan and frames its boundary when it arrives after the zones', async () => {
        siteNotFound();
        const { map, client } = await renderMap([incident({})], {
          zones: [zone()],
          sitePlan: null,
        });
        await waitFor(() => expect(client.getQueryState(queryKeys.sitePlan)?.status).toBe('error'));

        act(() => client.setQueryData(queryKeys.sitePlan, SITE_PLAN));

        await waitFor(() => expect(siteParts(map)).toEqual(['boundary', 'footprint']));
        expect(map.fitBounds).toHaveBeenLastCalledWith(siteBounds(SITE_PLAN, [zone()]), {
          padding: FIT,
          duration: 0,
        });
      });

      it('keeps a selected incident in view and its zone outlined when the plan arrives', async () => {
        siteNotFound();
        const { map, client } = await renderMap([incident({ id: 'a' })], {
          zones: [zone()],
          sitePlan: null,
        });
        await waitFor(() => expect(client.getQueryState(queryKeys.sitePlan)?.status).toBe('error'));
        act(() => useConsole.getState().select('a'));
        map.fitBounds.mockClear();
        map.setFilter.mockClear();

        act(() => client.setQueryData(queryKeys.sitePlan, SITE_PLAN));

        await waitFor(() =>
          expect(map.setFilter).toHaveBeenCalledWith(MAP_LAYERS.zoneHighlight, highlightOf('z1')),
        );
        // The sheet is open for the selection: the incident sits mid-way in the 760 px left of it.
        expect(map.easeTo).toHaveBeenLastCalledWith({
          center: POSITION,
          offset: [-220, 0],
          duration: 0,
        });
        expect(map.fitBounds).not.toHaveBeenCalled();
      });
    });
  });

  describe('camera views', () => {
    const viewLayerIds = cameraViewLayers().map((layer) => layer.id);

    const camera = (overrides: Partial<Camera>): Camera => ({
      id: 'c1',
      code: 'CAM-1',
      name: 'Library entrance',
      zoneId: 'z1',
      position: POSITION,
      online: true,
      fieldOfView: { heading: 0, angle: 90, range: 40 },
      ...overrides,
    });

    it('draws a view for each camera whose field of view is known', async () => {
      const { map } = await renderMap([], {
        cameras: [camera({ id: 'c1' }), camera({ id: 'c2', fieldOfView: null })],
      });

      const views = map.sources.get(MAP_SOURCES.cameraViews)!.setData.mock.lastCall![0] as {
        features: { properties: { id: string } }[];
      };
      expect(views.features.map((view) => view.properties.id)).toEqual(['c1']);
    });

    it('draws the views under the zone outlines when the zones are already there', async () => {
      const { map } = await renderMap([], { zones: [zone()] });

      const viewCalls = map.addLayer.mock.calls.filter(([layer]) =>
        viewLayerIds.includes(layer.id),
      );
      expect(viewCalls.map(([layer]) => layer.id)).toEqual(viewLayerIds);
      for (const [, before] of viewCalls) expect(before).toBe(MAP_LAYERS.zoneOutline);
    });

    it('explains the views in the legend', async () => {
      await renderMap([]);

      expect(screen.getByText('Camera view')).toBeInTheDocument();
    });
  });
  // A 1200 px map (`FakeMap.width`): an open sheet covers its right 440 px (`--sheet-inset`).
  describe('beside the sheet', () => {
    const SHEET_FIT = { ...FIT, right: 48 + 440 };
    const campus = () => siteBounds(SITE_PLAN, [zone()]);
    /** What the stage sets for the current display mode: the sheet's width, or 0 when full-screen. */
    const setSheetInset = (map: { container: HTMLElement }, value: string) =>
      map.container.style.setProperty('--sheet-inset', value);

    it('only resizes the canvas when its box changes', async () => {
      let onResize: (() => void) | undefined;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            onResize = callback;
          }
          observe() {}
          disconnect() {}
        },
      );
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });
      act(() => useConsole.getState().select('a'));
      map.easeTo.mockClear();
      map.fitBounds.mockClear();

      act(() => onResize!());

      expect(map.resize).toHaveBeenCalled();
      expect(map.easeTo).not.toHaveBeenCalled();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('keeps the selected incident beside the open sheet', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });

      act(() => useConsole.getState().select('a'));
      expect(map.easeTo).toHaveBeenLastCalledWith({
        center: POSITION,
        offset: [-220, 0],
        duration: 600,
      });

      act(() => useConsole.getState().select(null));
      expect(map.fitBounds).toHaveBeenLastCalledWith(campus(), { padding: FIT, duration: 600 });
    });

    it('frames the campus beside the report form', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });

      act(() => useConsole.getState().startReport());
      expect(map.fitBounds).toHaveBeenLastCalledWith(campus(), {
        padding: SHEET_FIT,
        duration: 600,
      });

      act(() => useConsole.getState().closeReport());
      expect(map.fitBounds).toHaveBeenLastCalledWith(campus(), { padding: FIT, duration: 600 });
    });

    it('fits the campus beside the sheet from the Fit campus button', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });
      act(() => useConsole.getState().select('a'));
      map.fitBounds.mockClear();

      await userEvent.click(screen.getByRole('button', { name: 'Fit campus' }));

      expect(map.fitBounds).toHaveBeenCalledWith(campus(), { padding: SHEET_FIT, duration: 600 });
    });

    it('keeps part of a narrow map in view', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });
      map.width = 400;

      act(() => useConsole.getState().select('a'));

      // 160 px stay visible: the sheet's inset shrinks to 240 px.
      expect(map.easeTo).toHaveBeenLastCalledWith({
        center: POSITION,
        offset: [-120, 0],
        duration: 600,
      });
    });

    it('centres on the incident as drawn when others share its spot', async () => {
      const incidents = [
        incident({ id: 'a', reportedAt: '2026-10-01T08:00:00.000Z' }),
        incident({ id: 'b', reportedAt: '2026-10-01T08:01:00.000Z' }),
      ];
      const { map } = await renderMap(incidents, { zones: [zone()] });

      act(() => useConsole.getState().select('b'));

      const drawn = incidentFeatures(incidents, 'b').selected.features[0]!.geometry.coordinates;
      expect(drawn).not.toEqual(POSITION);
      expect(map.easeTo).toHaveBeenLastCalledWith({
        center: drawn,
        offset: [-220, 0],
        duration: 600,
      });
    });

    it('does not pan when another incident arrives at the selected spot', async () => {
      const a = incident({ id: 'a', reportedAt: '2026-10-01T08:00:00.000Z' });
      const { map, client } = await renderMap([a], { zones: [zone()] });
      act(() => useConsole.getState().select('a'));
      map.easeTo.mockClear();

      // The newcomer fans both markers out, so the selected one moves a few metres.
      act(() =>
        client.setQueryData(queryKeys.incidents, [
          a,
          incident({ id: 'b', reportedAt: '2026-10-01T08:01:00.000Z' }),
        ]),
      );

      await waitFor(() => expect(ids(lastData(map, MAP_SOURCES.incidents))).toEqual(['b']));
      expect(map.easeTo).not.toHaveBeenCalled();
    });

    it("follows the sheet's width on a wall display", async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });
      setSheetInset(map, '495px');

      act(() => useConsole.getState().select('a'));
      expect(map.easeTo).toHaveBeenLastCalledWith({
        center: POSITION,
        offset: [-247.5, 0],
        duration: 600,
      });

      act(() => useConsole.getState().startReport());
      expect(map.fitBounds).toHaveBeenLastCalledWith(campus(), {
        padding: { ...FIT, right: 48 + 495 },
        duration: 600,
      });
    });

    it('pads nothing behind a sheet that covers the whole screen', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });
      setSheetInset(map, '0px');

      act(() => useConsole.getState().startReport());

      expect(map.fitBounds).toHaveBeenLastCalledWith(campus(), { padding: FIT, duration: 600 });
    });

    it('treats an unreadable sheet width as none', async () => {
      const { map } = await renderMap([incident({ id: 'a' })], { zones: [zone()] });
      setSheetInset(map, '');

      act(() => useConsole.getState().startReport());

      expect(map.fitBounds).toHaveBeenLastCalledWith(campus(), { padding: FIT, duration: 600 });
    });
  });

  describe('picking the report location', () => {
    /** Inside `zone()`, beside it in `otherZone()`, and outside both. */
    const INSIDE: [number, number] = [108.4415, 11.953];
    const IN_OTHER: [number, number] = [108.4422, 11.953];
    const OUTSIDE: [number, number] = [108.4428, 11.953];
    const otherZone = () =>
      zone({
        id: 'z2',
        code: 'BLD-DC',
        name: 'Data Center',
        polygon: [
          [108.442, 11.9527],
          [108.4424, 11.9527],
          [108.4424, 11.9533],
          [108.442, 11.9533],
          [108.442, 11.9527],
        ],
        center: [108.4422, 11.953],
      });
    const HINT = 'Click the map to place the incident · drag the pin to adjust';

    /** The report's pin: the only marker drawn as an SVG (zone labels and the code tag are text). */
    const pinMarker = () =>
      fake.FakeMarker.instances.find((marker) => marker.getElement().querySelector('svg'));

    async function startPicking() {
      const view = await renderMap([incident({ id: 'a' })], { zones: [zone(), otherZone()] });
      act(() => {
        useConsole.getState().startReport();
        useConsole.getState().setPicking(true);
      });
      return view;
    }

    it('places the pin where the map is clicked inside a zone', async () => {
      const { map } = await startPicking();

      act(() => clickAt(map, INSIDE));

      expect(useConsole.getState()).toMatchObject({ reportPosition: INSIDE, reportZoneId: 'z1' });
      expect(pinMarker()!.setLngLat).toHaveBeenCalledWith(INSIDE);
      expect(pinMarker()!.getElement()).toBeInTheDocument();
    });

    it('hides the pin from assistive tech: the zone list is the keyboard route', async () => {
      const { map } = await startPicking();

      act(() => clickAt(map, INSIDE));

      expect(pinMarker()!.getElement()).toHaveAttribute('aria-hidden', 'true');
    });

    it('places nothing outside every zone', async () => {
      const { map } = await startPicking();

      act(() => clickAt(map, OUTSIDE));

      expect(useConsole.getState()).toMatchObject({ reportPosition: null, pinMissed: true });
      expect(pinMarker()).toBeUndefined();
    });

    it('selects nothing and zooms into no cluster while picking', async () => {
      const { map } = await startPicking();
      const marker = { layer: { id: MAP_LAYERS.incidents }, properties: { id: 'a' } };

      map.queryRenderedFeatures.mockReturnValue([
        { layer: { id: MAP_LAYERS.clusters }, properties: { cluster_id: 7 } },
      ]);
      act(() => clickAt(map, INSIDE));
      expect(
        map.sources.get(MAP_SOURCES.incidents)!.getClusterExpansionZoom,
      ).not.toHaveBeenCalled();

      map.queryRenderedFeatures.mockReturnValue([marker]);
      act(() => clickAt(map, INSIDE));
      expect(useConsole.getState()).toMatchObject({ selectedIncidentId: null, reporting: true });

      act(() => useConsole.getState().setPicking(false));
      act(() => clickAt(map, INSIDE));
      expect(useConsole.getState().selectedIncidentId).toBe('a');
    });

    it('opens no camera while picking', async () => {
      const { map } = await startPicking();
      map.queryRenderedFeatures.mockReturnValue([
        { layer: { id: MAP_LAYERS.cameras }, properties: { id: 'c1' } },
      ]);

      act(() => clickAt(map, INSIDE));

      expect(useConsole.getState()).toMatchObject({ viewerCameraId: null, reporting: true });
    });

    it('shows a crosshair and the hint only while picking', async () => {
      const { map } = await startPicking();
      expect(map.canvas.style.cursor).toBe('crosshair');
      expect(screen.getByText(HINT)).toBeInTheDocument();

      act(() => useConsole.getState().setPicking(false));

      expect(map.canvas.style.cursor).toBe('');
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('drags the pin only while picking, selecting the zone it lands in', async () => {
      const { map } = await startPicking();
      act(() => clickAt(map, INSIDE));
      const pin = pinMarker()!;
      expect(pin.setDraggable).toHaveBeenLastCalledWith(true);

      act(() => pin.drag(IN_OTHER));
      expect(useConsole.getState()).toMatchObject({ reportPosition: IN_OTHER, reportZoneId: 'z2' });

      // Dropped outside every zone: back where it was, and the form warns.
      act(() => pin.drag(OUTSIDE));
      expect(useConsole.getState()).toMatchObject({ reportPosition: IN_OTHER, pinMissed: true });
      expect(pin.setLngLat).toHaveBeenLastCalledWith(IN_OTHER);

      act(() => useConsole.getState().setPicking(false));
      expect(pin.setDraggable).toHaveBeenLastCalledWith(false);
    });

    it('removes the pin with the report location', async () => {
      const { map } = await startPicking();
      act(() => clickAt(map, INSIDE));
      const first = pinMarker()!;

      act(() => useConsole.getState().clearPin());
      expect(first.getElement()).not.toBeInTheDocument();

      act(() => clickAt(map, INSIDE));
      const second = fake.FakeMarker.instances.at(-1)!;
      expect(second.getElement()).toBeInTheDocument();
      act(() => useConsole.getState().closeReport());
      expect(second.getElement()).not.toBeInTheDocument();
    });
  });
});
