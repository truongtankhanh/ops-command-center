import type { Role } from '@occ/contracts';
import { screen } from '@testing-library/react';
import { queryKeys } from './api/queries';
import { App } from './App';
import { useSession } from './auth/store';
import { AuthGate } from './components/AuthGate';
import { useTelemetryStore } from './realtime/telemetryStore';
import { useConsole } from './store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from './test-utils';
import { useToasts } from './ui/toasts';

/*
 * The console in a window opened as a video wall screen (`?wall=N`, V2-21.2): read-only for every role, with nothing
 * to press, no toast and no sound. The role cases mirror `App.a11y.test.tsx`'s.
 */

/** Inert: the wall never connects here. */
const fake = vi.hoisted(() => ({
  socket: {
    active: true,
    on: vi.fn(),
    emit: vi.fn(),
    io: { on: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

// `App` imports the whole console, and MapLibre cannot load without WebGL; the wall never draws a map, so an inert stand-in.
vi.mock('maplibre-gl', () => ({ default: { Map: class {}, Marker: class {} } }));
// The twin's chunk, stood in for: R3F needs WebGL. The wall mounts it, and what it draws is the twin's own tests'.
vi.mock('./twin/TwinStage', () => ({ default: () => <p>3D stage</p> }));
// The map the wall falls back to (V2-21.9): MapLibre is the map's own tests'; what is asserted is that the wall asked for it.
vi.mock('./components/CampusMap', () => ({
  CampusMap: ({ wall }: { wall?: boolean }) => (
    <section aria-label="Campus map">{wall ? '2D map (wall)' : '2D map'}</section>
  ),
}));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fake.socket) }));
vi.mock('./auth/session', () => ({
  getAccessToken: vi.fn(() => Promise.resolve(null)),
  renewSession: vi.fn(() => Promise.resolve(false)),
  signInAgain: vi.fn(),
  signOut: vi.fn(),
}));

const ROLES: Role[] = ['operator', 'supervisor', 'technician', 'viewer'];

/** Anything a person could press, type into or tab to. */
const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [tabindex], [role="button"]';

function renderWall(role: Role) {
  useSession.getState().signedIn({ displayName: 'Demo User', roles: [role] });
  useConsole.setState({ wall: 2 });
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, []);
  client.setQueryData(queryKeys.assets, []);
  return renderWithQueryClient(
    <AuthGate>
      <App />
    </AuthGate>,
    client,
  );
}

describe('the console on a video wall screen', () => {
  beforeEach(() => {
    stubTwinAvailable();
    resetStore(useConsole);
    resetStore(useSession);
    resetStore(useToasts);
    resetStore(useTelemetryStore);
    // Every query is seeded; a request that slips through stays pending instead of leaving the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => {
    unstubTwin();
    vi.unstubAllGlobals();
  });

  it.each(ROLES)('is one labelled screen with nothing to press, for a %s', (role) => {
    const { container } = renderWall(role);

    expect(screen.getByRole('main', { name: 'Video wall 2' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toHaveTextContent('Wall 2 · view only');
    expect(container.querySelectorAll(INTERACTIVE)).toHaveLength(0);
    // What the console has and the wall must not: a dialog, the toasts' region.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('region', { name: /notifications/i })).toBeNull();
  });

  it.each(ROLES)(
    'shows the 2D map with its tag and nothing to press where 3D is off, for a %s',
    async (role) => {
      unstubTwin();

      const { container } = renderWall(role);

      expect(await screen.findByText('2D map (wall)')).toBeInTheDocument();
      expect(screen.queryByText('3D stage')).toBeNull();
      expect(
        screen.getByText(/^2D map — 3D view isn't available on this device/),
      ).toBeInTheDocument();
      expect(container.querySelectorAll(INTERACTIVE)).toHaveLength(0);
      await expectNoAxeViolations(document.body, { screen: true });
    },
  );

  it.each(ROLES)('asks for data and writes none, for a %s', (role) => {
    renderWall(role);

    const requests = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => (init?.method ?? 'GET').toUpperCase());
    expect(requests.filter((method) => method !== 'GET')).toEqual([]);
  });

  it.each(ROLES)('has no axe violations, for a %s', async (role) => {
    renderWall(role);

    await expectNoAxeViolations(document.body, { screen: true });
  });
});
