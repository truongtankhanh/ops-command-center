import type { Incident } from '@occ/contracts';
import { act, screen } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from '../../test-utils';
import { WallApp } from './WallApp';

// `StageView` (which holds the lazy twin) imports the 2D map, and MapLibre cannot load without WebGL; the wall never draws a map.
vi.mock('maplibre-gl', () => ({ default: { Map: class {}, Marker: class {} } }));

// The twin's chunk, stood in for (R3F needs WebGL); the stand-in says whether the wall asked for its wall variant.
// The map the wall falls back to (V2-21.9): MapLibre is the map's own tests'; what is asserted is that the wall asked for it.
vi.mock('../map/CampusMap', () => ({
  CampusMap: ({ wall }: { wall?: boolean }) => (
    <section aria-label="Campus map">{wall ? '2D map (wall)' : '2D map'}</section>
  ),
}));

vi.mock('../../twin/TwinStage', () => ({
  default: ({ wall }: { wall?: boolean }) => <p>{wall ? '3D stage (wall)' : '3D stage'}</p>,
}));

const incident = (id: string, status: Incident['status']): Incident => ({
  id,
  code: id.toUpperCase(),
  type: 'fire_alarm',
  severity: 'high',
  status,
  title: id,
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
});

function renderWall(incidents: Incident[] = []) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.cameras, []);
  client.setQueryData(queryKeys.zones, []);
  client.setQueryData(queryKeys.sitePlan, {
    id: 'p',
    code: 'P',
    name: 'P',
    center: [0, 0],
    features: [],
  });
  client.setQueryData(queryKeys.assets, []);
  return renderWithQueryClient(<WallApp screen={3} />, client);
}

describe('WallApp', () => {
  const width = window.innerWidth;

  beforeEach(() => {
    stubTwinAvailable();
    resetStore(useConsole);
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1920,
    });
  });

  afterEach(() => {
    unstubTwin();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: width,
    });
    document.documentElement.style.removeProperty('--ui-scale');
  });

  it('is one main named for its screen, under the header', () => {
    renderWall();

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main', { name: 'Video wall 3' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Wall 3 · view only');
  });

  it("has the stage's region and the side column's two parts, each named", () => {
    renderWall();

    expect(screen.getByRole('region', { name: /^Campus 3D view/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cameras — incident first' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Active incidents · / })).toBeInTheDocument();
  });

  it('draws the twin on the stage with the wall variant, through the lazy chunk (V2-21.6)', async () => {
    renderWall();

    expect(await screen.findByText('3D stage (wall)')).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(screen.getByText('3D stage (wall)'));
  });

  it('counts the active incidents in the list heading by the feed’s rule', () => {
    renderWall([incident('a', 'open'), incident('b', 'acknowledged'), incident('c', 'resolved')]);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Active incidents · 2' }),
    ).toBeInTheDocument();
  });

  it('draws the legend over the stage (V2-21.8)', () => {
    renderWall();

    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Colour = severity');
  });

  it('flies to a new critical incident, shows the banner and counts down, with nothing selected (V2-21.8)', async () => {
    useConsole.setState({ wall: 3 });
    const { client } = renderWall([incident('a', 'open')]);
    expect(screen.queryByText('Campus view in')).not.toBeInTheDocument();

    act(() =>
      client.setQueryData(queryKeys.incidents, [
        incident('a', 'open'),
        { ...incident('crit', 'open'), severity: 'critical', title: 'Motor over-temperature' },
      ]),
    );

    // The title is in the list as well: the banner is known by its countdown and by what it announces.
    expect(await screen.findByText('Campus view in')).toBeInTheDocument();
    expect(screen.getByText('Critical incident CRIT: Motor over-temperature')).toBeInTheDocument();
    expect(screen.getByText('60 s')).toBeInTheDocument();
    expect(useConsole.getState().wallFocusId).toBe('crit');
    expect(useConsole.getState().selectedIncidentId).toBeNull();
  });

  it('keeps the focus banner over the map when the 3D view is lost mid-hold (V2-21.9)', async () => {
    useConsole.setState({ wall: 3 });
    const { client } = renderWall([incident('a', 'open')]);
    act(() =>
      client.setQueryData(queryKeys.incidents, [
        incident('a', 'open'),
        { ...incident('crit', 'open'), severity: 'critical', title: 'Motor over-temperature' },
      ]),
    );
    expect(await screen.findByText('Campus view in')).toBeInTheDocument();
    expect(await screen.findByText('3D stage (wall)')).toBeInTheDocument();

    act(() => useConsole.getState().markTwinLost('too-slow'));

    expect(await screen.findByText('2D map (wall)')).toBeInTheDocument();
    expect(screen.queryByText('3D stage (wall)')).not.toBeInTheDocument();
    expect(screen.getByText('Campus view in')).toBeInTheDocument();
    expect(useConsole.getState().wallFocusId).toBe('crit');
    expect(screen.getByText('2D map — 3D view was too slow')).toBeInTheDocument();
  });

  it('has nothing to press or tab to', () => {
    const { container } = renderWall([incident('a', 'open')]);

    expect(
      container.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]'),
    ).toHaveLength(0);
  });

  it("sets the wall's scale on <html> while it is mounted", () => {
    const { unmount } = renderWall();

    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.35');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('');
  });

  it('has no axe violations', async () => {
    renderWall([incident('a', 'open')]);

    await expectNoAxeViolations(document.body, { screen: true });
  });
});
