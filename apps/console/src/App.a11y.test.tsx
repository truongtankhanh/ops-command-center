import type {
  Camera,
  Incident,
  IncidentDetail,
  Role,
  SitePlan,
  StreamDescriptor,
  Zone,
} from '@occ/contracts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from './api/queries';
import { App } from './App';
import { useSession } from './auth/store';
import { AuthGate } from './components/AuthGate';
import { incidentToast } from './lib/attention';
import { useConsole } from './store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from './test-utils';
import { showToast, useToasts } from './ui/toasts';

/*
 * The whole console, as `main.tsx` mounts it, checked with axe screen by screen (UI-16 Q2 (b)).
 * Setup per docs/test/unit-react-infra-plan.occ-console.md § "B (b)".
 */

// MapLibre needs WebGL. The map never fires `load` here: the canvas, controls (disabled while there
// is no map), legend and tooltip are DOM and render without it, and layers are invisible to axe.
const fake = vi.hoisted(() => {
  class FakeMap {
    private readonly container: HTMLElement;
    constructor({ container }: { container: HTMLElement }) {
      this.container = container;
      // What MapLibre adds to its container: the focusable canvas region.
      const canvas = document.createElement('canvas');
      canvas.className = 'maplibregl-canvas';
      canvas.setAttribute('tabindex', '0');
      canvas.setAttribute('role', 'region');
      canvas.setAttribute('aria-label', 'Map');
      container.append(canvas);
    }
    on = vi.fn(() => this);
    off = vi.fn(() => this);
    remove = vi.fn();
    resize = vi.fn();
    getCanvas = () => this.container.querySelector('canvas')!;
    getContainer = () => this.container;
  }
  /** Inert: the console never connects here; connection states are set in the store per case. */
  const socket = {
    active: true,
    on: vi.fn(),
    io: { on: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return { FakeMap, socket };
});

vi.mock('maplibre-gl', () => ({ default: { Map: fake.FakeMap, Marker: class {} } }));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fake.socket) }));
// Queries ask for a token; the gate's buttons sign in and out.
vi.mock('./auth/session', () => ({
  getAccessToken: vi.fn(() => Promise.resolve(null)),
  renewSession: vi.fn(() => Promise.resolve(false)),
  signInAgain: vi.fn(),
  signOut: vi.fn(),
}));

const ZONES: Zone[] = [
  {
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
    center: [108.4415, 11.953],
  },
];

const SITE_PLAN: SitePlan = {
  id: 's1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: [108.4415, 11.953],
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

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'i1',
  code: 'INC-000001',
  type: 'fire_alarm',
  severity: 'critical',
  status: 'open',
  title: 'Smoke in the stairwell',
  description: null,
  zoneId: 'z1',
  position: [108.4415, 11.953],
  source: 'operator',
  reportedAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** One per status, so the feed's tabs, severity glyphs and status chips all have something to show. */
const INCIDENTS: Incident[] = [
  incident({}),
  incident({
    id: 'i2',
    code: 'INC-000002',
    type: 'intrusion',
    severity: 'high',
    status: 'acknowledged',
    title: 'Door forced open',
    acknowledgedAt: new Date().toISOString(),
  }),
  incident({
    id: 'i3',
    code: 'INC-000003',
    type: 'equipment_fault',
    severity: 'low',
    status: 'resolved',
    title: 'Card reader offline',
    acknowledgedAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
  }),
];

const camera = (overrides: Partial<Camera>): Camera => ({
  id: 'c1',
  code: 'CAM-L01',
  name: 'Library entrance',
  zoneId: 'z1',
  position: [108.4414, 11.9529],
  online: true,
  fieldOfView: null,
  ...overrides,
});

/** One live camera (its `hls` stream draws a notice, not a canvas) and one offline ("No signal"). */
const CAMERAS: Camera[] = [
  camera({}),
  camera({ id: 'c2', code: 'CAM-L02', name: 'Library reading room', online: false }),
];

const hls = (cameraId: string): StreamDescriptor => ({
  kind: 'hls',
  cameraId,
  label: cameraId,
  url: 'https://video.example/live.m3u8',
});

const detailOf = (item: Incident): IncidentDetail => ({ ...item, timeline: [] });

/** The console as `main.tsx` mounts it (without StrictMode and the top boundary), signed in as `role`. */
function renderConsole({
  role = 'operator',
  incidents = INCIDENTS,
}: { role?: Role; incidents?: Incident[] } = {}) {
  useSession.getState().signedIn({ displayName: 'Demo Operator', roles: [role] });
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.zones, ZONES);
  client.setQueryData(queryKeys.sitePlan, SITE_PLAN);
  client.setQueryData(queryKeys.cameras, CAMERAS);
  for (const item of CAMERAS) {
    if (item.online) client.setQueryData(queryKeys.stream(item.id), hls(item.id));
  }
  for (const item of incidents) client.setQueryData(queryKeys.incident(item.id), detailOf(item));
  return renderWithQueryClient(
    <AuthGate>
      <App />
    </AuthGate>,
    client,
  );
}

describe('the console', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    resetStore(useToasts);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    // Every query is seeded; a request that slips through stays pending instead of leaving the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders the signed-in console', () => {
    renderConsole();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Incidents' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Campus map' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cameras' })).toBeInTheDocument();
    expect(screen.getByText('INC-000001')).toBeInTheDocument();
  });

  it('has no axe violations on the overview', async () => {
    renderConsole();

    await expectNoAxeViolations(document.body, { screen: true });
  });

  // UI-16 Q2 (b): every main screen, reached first (so axe never passes on the wrong one), then checked
  // whole with `region` on.
  describe('main screens', () => {
    const consoleState = () => useConsole.getState();
    const checkPage = () => expectNoAxeViolations(document.body, { screen: true });

    it('the overview as a viewer', async () => {
      renderConsole({ role: 'viewer' });

      expect(screen.queryByRole('button', { name: 'Report incident' })).toBeNull();
      await checkPage();
    });

    it('the overview filtered by severity', async () => {
      renderConsole();

      act(() => consoleState().toggleSeverity('critical'));

      // The filter chip has no test file of its own: this is where it is checked (DN-T1).
      expect(screen.getByRole('button', { name: 'Clear severity filter' })).toBeInTheDocument();
      await checkPage();
    });

    it('an incident selected, as an operator', async () => {
      renderConsole();

      act(() => consoleState().select('i1'));

      expect(
        screen.getByRole('complementary', { name: 'Incident INC-000001' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('form', { name: 'Response' })).toBeInTheDocument();
      await checkPage();
    });

    it('an incident selected, as a viewer', async () => {
      renderConsole({ role: 'viewer' });

      act(() => consoleState().select('i1'));

      expect(screen.getByRole('note')).toHaveTextContent('View only');
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      await checkPage();
    });

    it('the report form', async () => {
      renderConsole();

      act(() => consoleState().startReport());

      expect(screen.getByRole('heading', { name: 'Report an incident' })).toBeInTheDocument();
      await checkPage();
    });

    it('the resolve confirmation', async () => {
      renderConsole();
      act(() => consoleState().select('i1'));

      // A critical incident without a note asks first.
      await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      expect(
        screen.getByRole('dialog', { name: 'Resolve INC-000001 without a note?' }),
      ).toBeInTheDocument();
      await checkPage();
    });

    it('a critical incident toast', async () => {
      renderConsole();

      act(() => showToast(incidentToast(INCIDENTS[0]!, 'Library', () => {})!));

      const notifications = screen.getByRole('region', { name: 'Notifications' });
      expect(within(notifications).getByText('Smoke in the stairwell')).toBeInTheDocument();
      await checkPage();
    });

    it('offline', async () => {
      renderConsole();

      act(() => consoleState().setConnection('offline'));

      expect(screen.getByText(/Live updates paused since/)).toBeInTheDocument();
      expect(screen.getByText(/Showing incidents as of/)).toBeInTheDocument();
      await checkPage();
    });

    it('the session-expired banner over the console', async () => {
      renderConsole();

      act(() => useSession.getState().expire());

      expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired.');
      await checkPage();
    });

    it('the camera viewer', async () => {
      renderConsole();

      act(() => consoleState().openViewer('c1'));

      expect(
        screen.getByRole('dialog', { name: 'Library entrance · CAM-L01' }),
      ).toBeInTheDocument();
      await checkPage();
    });

    it('the account menu open', async () => {
      renderConsole();

      await userEvent.click(screen.getByRole('button', { name: /Demo Operator/ }));

      const menu = screen.getByRole('group', { name: 'Account' });
      expect(within(menu).getAllByRole('switch')).toHaveLength(2);
      await checkPage();
    });

    it('the keyboard shortcuts help', async () => {
      renderConsole();

      act(() => consoleState().openShortcutHelp());

      expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
      await checkPage();
    });
  });
});
