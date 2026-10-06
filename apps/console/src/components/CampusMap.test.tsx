import type { Incident } from '@occ/contracts';
import { act, waitFor } from '@testing-library/react';
import type { FeatureCollection, Point } from 'geojson';
import { queryKeys } from '../api/queries';
import type { IncidentProperties } from '../lib/mapFeatures';
import { registerMapImages } from '../lib/mapImages';
import { MAP_LAYERS, MAP_SOURCES } from '../lib/mapLayers';
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

    constructor() {
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
    addLayer = vi.fn((layer: { id: string }) => void this.layers.add(layer.id));
    getLayer = vi.fn((id: string) => (this.styled(), this.layers.has(id) ? { id } : undefined));
    removeLayer = vi.fn((id: string) => (this.styled(), void this.layers.delete(id)));
    queryRenderedFeatures = vi.fn((): unknown[] => []);
    getCanvas = () => this.canvas;
    addControl = vi.fn();
    easeTo = vi.fn();
    fitBounds = vi.fn();
    resize = vi.fn();
    setPaintProperty = vi.fn();
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

// Rasterising needs an image decoder and fonts; the images themselves are tested in mapImages.test.
vi.mock('../lib/mapImages', () => ({
  registerMapImages: vi.fn(() => Promise.resolve()),
  addClusterCountImage: vi.fn(),
}));

const POSITION: [number, number] = [108.4415, 11.953];

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

/** Renders the map with everything cached, then (unless told not to) lets it finish loading. */
async function renderMap(incidents: Incident[], { load = true } = {}) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, []);
  client.setQueryData(queryKeys.cameras, []);
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
});
