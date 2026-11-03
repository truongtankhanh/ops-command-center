import { type Incident, IncidentEvents, type Role } from '@occ/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { queryKeys } from './api/queries';
import { App } from './App';
import { reauthenticate } from './auth/session';
import { useSession } from './auth/store';
import type * as CriticalCue from './lib/incidents/criticalCue';
import { playCriticalCue } from './lib/incidents/criticalCue';
import { AuthGate } from './components/auth/AuthGate';
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
vi.mock('./components/map/CampusMap', () => ({
  CampusMap: ({ wall }: { wall?: boolean }) => (
    <section aria-label="Campus map">{wall ? '2D map (wall)' : '2D map'}</section>
  ),
}));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fake.socket) }));
// The sound is the console's cue; a wall must make none, whatever the stored preference says.
vi.mock('./lib/incidents/criticalCue', async (importOriginal) => ({
  ...(await importOriginal<typeof CriticalCue>()),
  playCriticalCue: vi.fn(),
}));
vi.mock('./auth/session', () => ({
  getAccessToken: vi.fn(() => Promise.resolve(null)),
  renewSession: vi.fn(() => Promise.resolve(false)),
  reauthenticate: vi.fn(() => Promise.resolve()),
  signInAgain: vi.fn(),
  signOut: vi.fn(),
}));

const ROLES: Role[] = ['operator', 'supervisor', 'technician', 'viewer'];

/** Anything a person could press, type into or tab to. */
const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [tabindex], [role="button"]';

/** Everything a person could act on, by role: a wall draws none of it for anybody (brief § Accessibility). */
const CONTROL_ROLES = [
  'button',
  'link',
  'textbox',
  'tab',
  'combobox',
  'checkbox',
  'switch',
  'menuitem',
  'slider',
] as const;

/** A critical incident the telemetry rule raised, as the live event carries it. */
const CRITICAL: Incident = {
  id: 'crit-1',
  code: 'INC-000107',
  type: 'equipment_fault',
  severity: 'critical',
  status: 'open',
  title: 'Motor over-temperature — Cooling tower 1',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'telemetry',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

/** Twelve incidents raised a minute ago: above the ten in ten minutes that start an alarm flood (V3-21). None is critical, so the camera stays put. */
const flooded = (): Incident[] =>
  Array.from({ length: 12 }, (_, index) => ({
    ...CRITICAL,
    id: `flood-${index}`,
    code: `INC-0002${index}`,
    severity: 'medium',
    title: `Raised ${index}`,
    reportedAt: new Date(Date.now() - 60_000).toISOString(),
  }));

/** What the page's live link does when the API sends a new incident: the handler `useLiveIncidents` registered. */
function receive(incident: Incident): void {
  const call = fake.socket.on.mock.calls.findLast(([event]) => event === IncidentEvents.Created);
  const handler = call?.[1] as ((incident: Incident) => void) | undefined;
  if (!handler) throw new Error('The live incident link was not subscribed');
  act(() => handler(incident));
}

/** The methods of every request made so far. */
const methods = () =>
  vi.mocked(fetch).mock.calls.map(([, init]) => (init?.method ?? 'GET').toUpperCase());

function renderWall(role: Role, incidents: Incident[] = []) {
  useSession.getState().signedIn({ displayName: 'Demo User', roles: [role] });
  useConsole.setState({ wall: 2 });
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
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
    fake.socket.on.mockClear();
    vi.mocked(playCriticalCue).mockClear();
    vi.mocked(reauthenticate).mockClear();
    sessionStorage.clear();
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

  it.each(ROLES)('has no control by role, for a %s', (role) => {
    renderWall(role);

    for (const name of CONTROL_ROLES) expect(screen.queryAllByRole(name), name).toHaveLength(0);
  });

  describe('when a critical incident arrives', () => {
    // Sound is switched on in the store on purpose: what keeps a wall silent is the wall, not the preference.
    beforeEach(() => useConsole.setState({ criticalSound: true }));

    it.each(ROLES)(
      'flies the banner in and makes no toast and no sound, for a %s',
      async (role) => {
        const { container } = renderWall(role);

        receive(CRITICAL);

        expect(await screen.findByText('Campus view in')).toBeInTheDocument();
        expect(useToasts.getState().toasts).toHaveLength(0);
        expect(screen.queryByRole('region', { name: /notifications/i })).toBeNull();
        expect(playCriticalCue).not.toHaveBeenCalled();
        expect(useConsole.getState().selectedIncidentId).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(container.querySelectorAll(INTERACTIVE)).toHaveLength(0);
        for (const name of CONTROL_ROLES) expect(screen.queryAllByRole(name), name).toHaveLength(0);
      },
    );

    it.each(ROLES)('says it once and writes nothing, for a %s', async (role) => {
      renderWall(role);

      receive(CRITICAL);
      await screen.findByText('Campus view in');

      const announcements = screen
        .getAllByRole('status')
        .filter((node) => /Critical incident/.test(node.textContent ?? ''));
      expect(announcements).toHaveLength(1);
      // The countdown is not in any live region, so it is not read out every second.
      expect(screen.getByText(/^\d+ s$/).closest('[role="status"]')).toBeNull();
      expect(methods().filter((method) => method !== 'GET')).toEqual([]);
    });

    it.each(ROLES)('has no axe violations while the camera is on it, for a %s', async (role) => {
      renderWall(role);
      receive(CRITICAL);
      await screen.findByText('Campus view in');

      await expectNoAxeViolations(document.body, { screen: true });
    });

    it('has no axe violations on the map the wall falls back to, with the banner over it', async () => {
      renderWall('viewer');
      receive(CRITICAL);
      await screen.findByText('Campus view in');

      act(() => useConsole.getState().markTwinLost('too-slow'));

      expect(await screen.findByText('2D map (wall)')).toBeInTheDocument();
      expect(screen.getByText('Campus view in')).toBeInTheDocument();
      await expectNoAxeViolations(document.body, { screen: true });
    });
  });

  it.each(ROLES)(
    'says the session is reconnecting, with nothing to press and no axe violation, for a %s',
    async (role) => {
      const { container } = renderWall(role);

      act(() => useSession.getState().expire());

      expect(screen.getByText('Session reconnecting…')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      // Nobody is there to press "Sign in again": the wall signs itself in.
      await waitFor(() => expect(reauthenticate).toHaveBeenCalledTimes(1));
      expect(container.querySelectorAll(INTERACTIVE)).toHaveLength(0);
      for (const name of CONTROL_ROLES) expect(screen.queryAllByRole(name), name).toHaveLength(0);
      await expectNoAxeViolations(document.body, { screen: true });
    },
  );

  // V3-21.5: the wall is for watching. In a flood it reads the load as text in its bar, whatever the role, and the console's
  // banner, switch, panel and grouped list are not there to press (`WallApp.test.tsx` and `StatusBar.test.tsx` hold the pieces).
  describe('in an alarm flood', () => {
    // Grouping is chosen on purpose: what keeps a wall ungrouped is the wall, not the stored choice.
    beforeEach(() => useConsole.setState({ groupByZone: true }));

    it.each(ROLES)(
      'reads the load as text in the bar, with no banner, no panel and nothing to press, for a %s',
      (role) => {
        const { container } = renderWall(role, flooded());

        const bar = screen.getByRole('contentinfo', { name: 'System status' });
        expect(bar).toHaveTextContent('Alarm flood · 12 / 10 min');
        expect(bar.querySelector('[data-segment="alarms"]')?.closest('button')).toBeNull();
        expect(screen.queryByText(/^Alarm flood:/)).toBeNull();
        expect(screen.queryByRole('group', { name: 'Alarm load' })).toBeNull();
        expect(screen.queryByText(/Grouped by zone/)).toBeNull();
        expect(container.querySelectorAll(INTERACTIVE)).toHaveLength(0);
        for (const name of CONTROL_ROLES) expect(screen.queryAllByRole(name), name).toHaveLength(0);
        // One live region in the bar, the summary; the flood is not announced there, and there is no banner to announce it.
        expect(within(bar).getAllByRole('status')).toHaveLength(1);
        expect(within(bar).getByRole('status')).not.toHaveTextContent(/flood/i);
        expect(methods().filter((method) => method !== 'GET')).toEqual([]);
      },
    );

    it('has no axe violations', async () => {
      renderWall('viewer', flooded());

      await expectNoAxeViolations(document.body, { screen: true });
    });
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
