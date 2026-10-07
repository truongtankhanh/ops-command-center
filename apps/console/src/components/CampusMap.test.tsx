import type { Camera, Incident, SitePlan, Zone } from '@occ/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FeatureCollection, Geometry, Point } from 'geojson';
import { queryKeys } from '../api/queries';
import { incidentFeatures, type IncidentProperties } from '../lib/mapFeatures';
import { registerMapImages } from '../lib/mapImages';
import {
  cameraViewLayers,
  groundLayers,
  MAP_LAYERS,
  MAP_SOURCES,
  zoneOverlayLayers,
} from '../lib/mapLayers';
import { siteBounds, type SiteProperties } from '../lib/sitePlan';
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
    /** What the component passed to `new Map(...)`. */
    readonly options: Record<string, unknown>;

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
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
    getContainer = () => ({ clientWidth: this.width });
    addControl = vi.fn();
    easeTo = vi.fn();
    fitBounds = vi.fn();
    resize = vi.fn();
    setPaintProperty = vi.fn();
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
    private readonly element: HTMLElement;
    constructor({ element }: { element: HTMLElement }) {
      FakeMarker.created += 1;
      this.element = element;
    }
    setLngLat = vi.fn(() => this);
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
    zones = [] as Zone[],
    sitePlan = SITE_PLAN as SitePlan | null,
    cameras = [] as Camera[],
  }: { load?: boolean; zones?: Zone[]; sitePlan?: SitePlan | null; cameras?: Camera[] } = {},
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, zones);
  // `null`: not cached, so the map asks the API for it.
  if (sitePlan) client.setQueryData(queryKeys.sitePlan, sitePlan);
  client.setQueryData(queryKeys.cameras, cameras);
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

describe('CampusMap', () => {
  beforeEach(() => {
    resetStore(useConsole);
    fake.maps.length = 0;
    fake.FakeMarker.created = 0;
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
      MAP_SOURCES.incidents,
      MAP_SOURCES.selected,
    ]);
    expect(map.layers).toContain(MAP_LAYERS.incidents);
    expect(ids(lastData(map, MAP_SOURCES.incidents))).toEqual(['a']);
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
  // A 1200 px map (`FakeMap.width`): an open sheet covers its right 440 px.
  describe('beside the sheet', () => {
    const SHEET_FIT = { ...FIT, right: 48 + 440 };
    const campus = () => siteBounds(SITE_PLAN, [zone()]);

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
  });
});
