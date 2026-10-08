import type { Camera, Incident, Zone } from '@occ/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { queryKeys } from '../api/queries';
import { MAP_LAYERS } from '../lib/mapLayers';
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
  }: { incidents?: Incident[]; cameras?: Camera[]; zones?: Zone[] } = {},
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.cameras, cameras);
  client.setQueryData(queryKeys.zones, zones);
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

describe('MapTooltip', () => {
  beforeEach(() => resetStore(useConsole));

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
