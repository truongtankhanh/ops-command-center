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

  afterEach(() => vi.unstubAllGlobals());

  it.each(ROLES)('is one labelled screen with nothing to press, for a %s', (role) => {
    const { container } = renderWall(role);

    const wall = screen.getByRole('main', { name: 'Video wall 2' });
    expect(wall).toBeEmptyDOMElement();
    expect(container.querySelectorAll(INTERACTIVE)).toHaveLength(0);
    // What the console has and the wall must not: the header, the help, a dialog, the toasts' region.
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('region', { name: /notifications/i })).toBeNull();
  });

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
