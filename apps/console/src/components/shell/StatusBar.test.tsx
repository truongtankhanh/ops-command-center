import { type Asset, type Incident, ROLES } from '@occ/contracts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../api/client';
import { queryKeys } from '../../api/queries';
import { useSession } from '../../auth/store';
import type * as CriticalCue from '../../lib/incidents/criticalCue';
import { unlockAudio } from '../../lib/incidents/criticalCue';
import { CONNECTION_LABEL, TELEMETRY_LABEL } from '../../lib/shell/connectionLabels';
import { initialTelemetryState, type TelemetryPillState } from '../../lib/telemetry/telemetryState';
import { TWIN_UNAVAILABLE_COPY } from '../../lib/twin-core/twinCapability';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from '../../test-utils';
import { StatusBar } from './StatusBar';

// jsdom has no Web Audio; the sound preference itself is stored by the real module (as `Header.test.tsx`).
vi.mock('../../lib/incidents/criticalCue', async (importOriginal) => ({
  ...(await importOriginal<typeof CriticalCue>()),
  unlockAudio: vi.fn(),
  playCriticalCue: vi.fn(),
}));

/** The telemetry pill's state, from the two facts it is derived from (`telemetryPillState`). */
function holdTelemetry(pill: TelemetryPillState) {
  const state =
    pill === 'live' || pill === 'paused'
      ? { ...initialTelemetryState, socket: 'live' as const, upstream: pill }
      : { ...initialTelemetryState, socket: pill };
  act(() => useTelemetryStore.setState({ view: { state, series: new Map() } }));
}

/** Every fact good: events and telemetry live, 3D drawable and chosen, session fine. */
function allGood() {
  stubTwinAvailable();
  act(() => {
    useConsole.getState().setConnection('live');
    useConsole.setState({ view: '3d' });
  });
  holdTelemetry('live');
}

const bar = () => screen.getByRole('contentinfo', { name: 'System status' });
const summary = () => within(bar()).getByRole('status');
const segment = (id: 'engine' | 'events' | 'telemetry' | 'alarms') =>
  bar().querySelector<HTMLElement>(`[data-segment="${id}"]`)!;

// The alarm-load segment reads the incident list and the catalogue (V3-21.2). Unseeded, a query waits on a request that never
// settles, which is "not loaded yet"; a case that needs a list seeds the client it renders with.
const reportedAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
let sequence = 0;
const incident = (overrides: Partial<Incident> = {}): Incident => {
  sequence += 1;
  return {
    id: `i${sequence}`,
    code: `INC-${sequence}`,
    type: 'fire_alarm',
    severity: 'medium',
    status: 'open',
    title: 'Test',
    description: null,
    zoneId: 'z1',
    position: [108.44, 11.95],
    source: 'operator',
    reportedAt: reportedAgo(60_000),
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    ...overrides,
  };
};
const ROUTER: Asset = {
  id: 'asset-rt-01',
  code: 'RT-01',
  name: 'Core router',
  class: {
    id: 'class-router',
    code: 'router',
    name: 'Router',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'z1',
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [],
};
/** A client with the incident list (and, if given, the catalogue) already in it, so the segment is "loaded". */
function seededClient(incidents: Incident[], assets?: Asset[]) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  if (assets) client.setQueryData(queryKeys.assets, assets);
  return client;
}

describe('StatusBar', () => {
  // The stores are module-level singletons: without a reset, one case's state leaks into the next.
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    holdTelemetry('connecting');
    sequence = 0;
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => {
    unstubTwin();
    vi.restoreAllMocks();
  });

  it('is the console\'s footer, named "System status"', () => {
    renderWithQueryClient(<StatusBar />);

    expect(bar()).toBeInTheDocument();
  });

  describe('when everything is good', () => {
    it('says the system is healthy, with the three states behind it', () => {
      allGood();
      renderWithQueryClient(<StatusBar />);

      expect(bar()).toHaveAttribute('data-level', 'healthy');
      expect(summary()).toHaveTextContent('System healthy');
      expect(segment('engine')).toHaveTextContent('3D 3D view');
      expect(segment('events')).toHaveTextContent('Events Live');
      expect(segment('telemetry')).toHaveTextContent('Telemetry Live');
      for (const id of ['engine', 'events', 'telemetry'] as const) {
        expect(segment(id)).toHaveAttribute('data-state', 'ok');
      }
    });

    it('says 2D map when the operator chose the map on a device that could draw 3D', () => {
      allGood();
      act(() => useConsole.setState({ view: '2d' }));
      renderWithQueryClient(<StatusBar />);

      expect(summary()).toHaveTextContent('System healthy');
      expect(segment('engine')).toHaveTextContent('2D map');
      expect(segment('engine')).toHaveAttribute('data-state', 'ok');
    });
  });

  describe('when one thing is wrong', () => {
    it.each(['reconnecting', 'offline'] as const)(
      "says it for events %s, in the pill's words",
      (connection) => {
        allGood();
        renderWithQueryClient(<StatusBar />);

        act(() => useConsole.getState().setConnection(connection));

        expect(bar()).toHaveAttribute('data-level', 'degraded');
        expect(summary()).toHaveTextContent(CONNECTION_LABEL[connection]);
        expect(segment('events')).toHaveTextContent(CONNECTION_LABEL[connection]);
        expect(segment('events')).not.toHaveAttribute('data-state', 'ok');
      },
    );

    it.each(['paused', 'reconnecting', 'unavailable'] as const)(
      "says it for telemetry %s, in the pill's words",
      (pill) => {
        allGood();
        renderWithQueryClient(<StatusBar />);

        holdTelemetry(pill);

        expect(bar()).toHaveAttribute('data-level', 'degraded');
        expect(summary()).toHaveTextContent(TELEMETRY_LABEL[pill]);
        expect(segment('telemetry')).toHaveTextContent(TELEMETRY_LABEL[pill]);
        expect(segment('telemetry')).not.toHaveAttribute('data-state', 'ok');
      },
    );

    it.each(['context-lost', 'too-slow'] as const)(
      "says it when the 3D view fails (%s), in the fallback banner's words",
      (fault) => {
        allGood();
        renderWithQueryClient(<StatusBar />);

        act(() => useConsole.getState().markTwinLost(fault));

        expect(bar()).toHaveAttribute('data-level', 'degraded');
        expect(summary()).toHaveTextContent(TWIN_UNAVAILABLE_COPY[fault].title);
        expect(segment('engine')).toHaveTextContent(TWIN_UNAVAILABLE_COPY[fault].title);
        expect(segment('engine')).toHaveAttribute('data-state', 'warn');
      },
    );

    it('says the session expired, with every segment still fine', () => {
      allGood();
      renderWithQueryClient(<StatusBar />);

      act(() => useSession.getState().expire());

      expect(bar()).toHaveAttribute('data-level', 'degraded');
      expect(summary()).toHaveTextContent('Session expired');
      for (const id of ['engine', 'events', 'telemetry'] as const) {
        expect(segment(id)).toHaveAttribute('data-state', 'ok');
      }
    });

    it('does not call a device without WebGL 2 degraded, but still says why 3D is off', () => {
      // No `stubTwinAvailable`: jsdom has no WebGL 2.
      act(() => useConsole.getState().setConnection('live'));
      holdTelemetry('live');
      renderWithQueryClient(<StatusBar />);

      expect(bar()).toHaveAttribute('data-level', 'healthy');
      expect(summary()).toHaveTextContent('System healthy');
      expect(segment('engine')).toHaveTextContent(TWIN_UNAVAILABLE_COPY['no-webgl2'].title);
      expect(segment('engine')).toHaveAttribute('data-state', 'off');
    });

    it('does not call a link being made a problem', () => {
      allGood();
      act(() => useConsole.getState().setConnection('connecting'));
      holdTelemetry('connecting');
      renderWithQueryClient(<StatusBar />);

      expect(bar()).toHaveAttribute('data-level', 'healthy');
      expect(segment('events')).toHaveTextContent(CONNECTION_LABEL.connecting);
      expect(segment('telemetry')).toHaveTextContent(TELEMETRY_LABEL.connecting);
    });
  });

  describe('when several things are wrong', () => {
    it('summarises the first in the order session, events, telemetry, engine, and shows every state', () => {
      allGood();
      renderWithQueryClient(<StatusBar />);

      act(() => {
        useSession.getState().expire();
        useConsole.getState().setConnection('offline');
      });
      holdTelemetry('paused');
      act(() => useConsole.getState().markTwinLost('too-slow'));

      expect(summary()).toHaveTextContent('Session expired');
      expect(segment('events')).toHaveAttribute('data-state', 'off');
      expect(segment('telemetry')).toHaveAttribute('data-state', 'warn');
      expect(segment('engine')).toHaveAttribute('data-state', 'warn');
    });

    it('falls to the events, then the telemetry, as the earlier ones clear', () => {
      allGood();
      renderWithQueryClient(<StatusBar />);
      act(() => useConsole.getState().setConnection('offline'));
      holdTelemetry('paused');

      expect(summary()).toHaveTextContent(CONNECTION_LABEL.offline);

      act(() => useConsole.getState().setConnection('live'));

      expect(summary()).toHaveTextContent(TELEMETRY_LABEL.paused);
    });
  });

  describe('the live region', () => {
    it('is the summary alone, mounted for good, and the segments hold none', () => {
      allGood();
      renderWithQueryClient(<StatusBar />);

      const regions = within(bar()).getAllByRole('status');
      expect(regions).toHaveLength(1);
      expect(regions[0]).toBe(summary());
      for (const id of ['engine', 'events', 'telemetry'] as const) {
        expect(within(segment(id)).queryByRole('status')).toBeNull();
        expect(segment(id).closest('[role="status"]')).toBeNull();
      }
      expect(bar().querySelector('[aria-live]')).toBeNull();
    });

    it('keeps the same element when the sentence changes, so the change is announced', () => {
      allGood();
      renderWithQueryClient(<StatusBar />);
      const before = summary();

      act(() => useConsole.getState().setConnection('offline'));

      expect(summary()).toBe(before);
      expect(before).toHaveTextContent(CONNECTION_LABEL.offline);
    });
  });

  describe('what it leaves out', () => {
    it('draws two actions, the alarm load and Settings, and no FPS or other bare number', () => {
      allGood();
      renderWithQueryClient(<StatusBar />);

      // The three health segments are text; the controls are the alarm-load button and Settings, and both panels are closed.
      expect(within(bar()).getAllByRole('button')).toEqual([
        within(bar()).getByRole('button', { name: /^Alarms / }),
        within(bar()).getByRole('button', { name: 'Settings' }),
      ]);
      for (const role of ['link', 'switch', 'checkbox', 'menuitem'] as const) {
        expect(within(bar()).queryAllByRole(role), role).toHaveLength(0);
      }
      // The alarm rate is a count the console already shows (V3-21.2 amends V3-06.2); every other number is still out.
      const text = (bar().textContent ?? '').replace(segment('alarms').textContent ?? '', '');
      expect(text).not.toMatch(/fps/i);
      expect(text).not.toMatch(/(^|\s)\d+([.,]\d+)?(\s|$)/);
    });

    it.each(ROLES)(
      'is the same for a %s: reading the state is not an action on the site',
      (role) => {
        useSession.setState({ status: 'signed-in', user: { displayName: 'Test', roles: [role] } });
        allGood();
        renderWithQueryClient(<StatusBar />);

        expect(bar()).toHaveAttribute('data-level', 'healthy');
        expect(summary()).toHaveTextContent('System healthy');
        expect(segment('events')).toHaveTextContent('Events Live');
      },
    );
  });

  // V3-21.2 and V3-21.3: the workload beside the health. The panel's own rows are `AlarmLoadPanel.test.tsx`'s.
  describe('the alarm load', () => {
    const alarmButton = () => within(bar()).getByRole('button', { name: /^Alarm/ });
    const panel = () => screen.queryByRole('group', { name: 'Alarm load' });
    const calm = () => seededClient([incident(), incident(), incident()], [ROUTER]);
    const flood = () =>
      seededClient(
        Array.from({ length: 11 }, () => incident()),
        [ROUTER],
      );

    beforeEach(allGood);

    it('reads a dash until the list is loaded, never a 0', () => {
      renderWithQueryClient(<StatusBar />);

      expect(alarmButton()).toHaveAccessibleName('Alarms — / 10 min');
      expect(segment('alarms')).toHaveAttribute('data-state', 'ok');
    });

    it('reads the rate once the list is loaded, neutral', () => {
      renderWithQueryClient(<StatusBar />, calm());

      expect(alarmButton()).toHaveAccessibleName('Alarms 3 / 10 min');
      expect(segment('alarms')).toHaveAttribute('data-state', 'ok');
    });

    it('reads 0 for a quiet list that is known', () => {
      renderWithQueryClient(<StatusBar />, seededClient([]));

      expect(alarmButton()).toHaveAccessibleName('Alarms 0 / 10 min');
    });

    it('says a flood in words and state above ten in ten minutes', () => {
      renderWithQueryClient(<StatusBar />, flood());

      expect(alarmButton()).toHaveAccessibleName('Alarm flood · 11 / 10 min');
      expect(segment('alarms')).toHaveAttribute('data-state', 'warn');
    });

    it('is workload, not a fault: the summary stays healthy during a flood', () => {
      renderWithQueryClient(<StatusBar />, flood());

      expect(bar()).toHaveAttribute('data-level', 'healthy');
      expect(summary()).toHaveTextContent('System healthy');
    });

    it('is not a live region, so a flood is announced by the banner and not here', () => {
      renderWithQueryClient(<StatusBar />, flood());

      expect(within(bar()).getAllByRole('status')).toEqual([summary()]);
      expect(segment('alarms').closest('[role="status"]')).toBeNull();
    });

    it('is closed at first, and announces no popup it does not have', () => {
      renderWithQueryClient(<StatusBar />, calm());

      expect(alarmButton()).toHaveAttribute('aria-expanded', 'false');
      expect(alarmButton()).not.toHaveAttribute('aria-haspopup');
      expect(panel()).toBeNull();
    });

    it('opens the panel upward, with the four measures', async () => {
      renderWithQueryClient(<StatusBar />, calm());

      await userEvent.click(alarmButton());

      expect(alarmButton()).toHaveAttribute('aria-expanded', 'true');
      expect(panel()).toHaveAttribute('data-placement', 'above');
      const group = within(panel()!);
      expect(group.getByText(/raised in 10 min/)).toBeInTheDocument();
      expect(group.getByText(/open past their attention time/)).toBeInTheDocument();
      expect(group.getByRole('img', { name: /^Raised per 10 minutes/ })).toBeInTheDocument();
    });

    it('closes on Escape and gives focus back to the alarm button', async () => {
      renderWithQueryClient(<StatusBar />, calm());
      await userEvent.click(alarmButton());

      await userEvent.keyboard('{Escape}');

      expect(panel()).toBeNull();
      expect(alarmButton()).toHaveFocus();
    });

    it('opens an asset from a noisy row, closed first, focus on the alarm button', async () => {
      const client = seededClient([incident({ assetId: ROUTER.id })], [ROUTER]);
      renderWithQueryClient(<StatusBar />, client);
      await userEvent.click(alarmButton());

      await userEvent.click(within(panel()!).getByRole('button', { name: /^RT-01/ }));

      expect(useConsole.getState().selectedAssetCode).toBe('RT-01');
      expect(panel()).toBeNull();
      expect(alarmButton()).toHaveFocus();
    });

    it.each(ROLES)(
      'is offered to a %s: reading the load is not an action on the site',
      async (role) => {
        useSession.setState({ status: 'signed-in', user: { displayName: 'Test', roles: [role] } });
        renderWithQueryClient(<StatusBar />, calm());

        await userEvent.click(alarmButton());

        expect(panel()).toBeInTheDocument();
      },
    );

    it('opens one panel at a time with Settings, each its own', async () => {
      renderWithQueryClient(<StatusBar />, calm());
      await userEvent.click(alarmButton());

      await userEvent.click(within(bar()).getByRole('button', { name: 'Settings' }));

      expect(panel()).toBeNull();
      expect(screen.getByRole('group', { name: 'Settings' })).toBeInTheDocument();
    });

    it('leaves the summary as the only live region while it is open', async () => {
      renderWithQueryClient(<StatusBar />, flood());

      await userEvent.click(alarmButton());

      expect(within(bar()).getAllByRole('status')).toEqual([summary()]);
      expect(screen.getAllByRole('status')).toEqual([summary()]);
    });

    it('has no axe violations, loading, calm, flooding or open', async () => {
      const loading = renderWithQueryClient(<StatusBar />);
      await expectNoAxeViolations();
      loading.unmount();

      const calmBar = renderWithQueryClient(<StatusBar />, calm());
      await expectNoAxeViolations();
      calmBar.unmount();

      renderWithQueryClient(<StatusBar />, flood());
      await expectNoAxeViolations();
      await userEvent.click(alarmButton());
      await expectNoAxeViolations();
    });
  });

  // V3-06.4: the video wall's foot. The console's sentence and segments, with nothing to press (`WallApp.test.tsx` mounts it there).
  describe('read-only (the video wall)', () => {
    const INTERACTIVE =
      'button, a[href], input, select, textarea, summary, [tabindex], [role="button"]';

    it('says what the console does, with nothing to press or tab to', () => {
      allGood();
      renderWithQueryClient(<StatusBar readOnly />);

      expect(bar()).toHaveAttribute('data-level', 'healthy');
      expect(summary()).toHaveTextContent('System healthy');
      expect(segment('engine')).toHaveTextContent('3D 3D view');
      expect(segment('events')).toHaveTextContent('Events Live');
      expect(segment('telemetry')).toHaveTextContent('Telemetry Live');
      expect(bar().querySelectorAll(INTERACTIVE)).toHaveLength(0);
      expect(within(bar()).queryAllByRole('button')).toHaveLength(0);
    });

    it.each(ROLES)('offers no Settings to a %s', (role) => {
      useSession.setState({ status: 'signed-in', user: { displayName: 'Test', roles: [role] } });
      allGood();
      renderWithQueryClient(<StatusBar readOnly />);

      expect(within(bar()).queryByRole('button', { name: 'Settings' })).toBeNull();
      expect(summary()).toHaveTextContent('System healthy');
    });

    it("says a lost events link and paused telemetry in the console's words", () => {
      allGood();
      renderWithQueryClient(<StatusBar readOnly />);

      act(() => useConsole.getState().setConnection('offline'));
      holdTelemetry('paused');

      expect(bar()).toHaveAttribute('data-level', 'degraded');
      expect(summary()).toHaveTextContent(CONNECTION_LABEL.offline);
      expect(segment('events')).toHaveTextContent(CONNECTION_LABEL.offline);
      expect(segment('telemetry')).toHaveTextContent(TELEMETRY_LABEL.paused);
    });

    it('keeps the summary as the only live region', () => {
      allGood();
      renderWithQueryClient(<StatusBar readOnly />);

      expect(within(bar()).getAllByRole('status')).toEqual([summary()]);
    });

    it('draws the alarm load as text only: no button, no panel, nothing to tab to', () => {
      allGood();
      renderWithQueryClient(<StatusBar readOnly />, seededClient([incident(), incident()]));

      expect(segment('alarms')).toHaveTextContent('Alarms 2 / 10 min');
      expect(segment('alarms').closest('button')).toBeNull();
      expect(within(bar()).queryByRole('button', { name: /^Alarm/ })).toBeNull();
      expect(screen.queryByRole('group', { name: 'Alarm load' })).toBeNull();
    });

    it('says a flood on the wall in the console’s words, and keeps the summary healthy', () => {
      allGood();
      renderWithQueryClient(
        <StatusBar readOnly />,
        seededClient(Array.from({ length: 11 }, () => incident())),
      );

      expect(segment('alarms')).toHaveTextContent('Alarm flood · 11 / 10 min');
      expect(segment('alarms')).toHaveAttribute('data-state', 'warn');
      expect(summary()).toHaveTextContent('System healthy');
    });

    it("reads 3D view on a wall whatever 2D/3D choice is stored for the console's operators", () => {
      allGood();
      act(() => useConsole.setState({ wall: 2, view: '2d' }));
      renderWithQueryClient(<StatusBar readOnly />);

      expect(segment('engine')).toHaveTextContent('3D 3D view');
      expect(segment('engine')).toHaveAttribute('data-state', 'ok');
      expect(bar()).toHaveAttribute('data-level', 'healthy');
    });

    it('still says a 3D fault on a wall, in the fallback banner’s words', () => {
      allGood();
      act(() => useConsole.setState({ wall: 2 }));
      renderWithQueryClient(<StatusBar readOnly />);

      act(() => useConsole.getState().markTwinLost('too-slow'));

      expect(bar()).toHaveAttribute('data-level', 'degraded');
      expect(summary()).toHaveTextContent(TWIN_UNAVAILABLE_COPY['too-slow'].title);
      expect(segment('engine')).toHaveAttribute('data-state', 'warn');
    });

    it('has no axe violations, healthy or degraded', async () => {
      allGood();
      renderWithQueryClient(<StatusBar readOnly />);
      await expectNoAxeViolations();

      act(() => useConsole.getState().setConnection('offline'));
      await expectNoAxeViolations();
    });
  });

  // V3-06.3: the account menu's rows, in a popover that opens upward. The rows themselves are `SettingsSwitches.test.tsx`'s.
  describe('Settings', () => {
    const settingsButton = () => within(bar()).getByRole('button', { name: 'Settings' });
    const panel = () => screen.queryByRole('group', { name: 'Settings' });
    const open = () => userEvent.click(settingsButton());

    beforeEach(() => {
      localStorage.clear();
      vi.mocked(unlockAudio).mockReset().mockResolvedValue(true);
      allGood();
    });

    it('is closed at first, with no switch on the page', () => {
      renderWithQueryClient(<StatusBar />);

      expect(settingsButton()).toHaveAttribute('aria-expanded', 'false');
      expect(panel()).toBeNull();
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });

    it('opens to the three switches and the help button, upward', async () => {
      renderWithQueryClient(<StatusBar />);

      await open();

      expect(settingsButton()).toHaveAttribute('aria-expanded', 'true');
      const group = within(panel()!);
      expect(group.getAllByRole('switch').map((node) => node.textContent)).toEqual([
        'Sound for critical incidents',
        'Single-key shortcuts',
        'Compact layout',
      ]);
      expect(group.getByRole('button', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
      expect(panel()).toHaveAttribute('data-placement', 'above');
    });

    it("changes the same state as the account menu's switches", async () => {
      renderWithQueryClient(<StatusBar />);
      await open();
      const group = within(panel()!);

      await userEvent.click(group.getByRole('switch', { name: 'Sound for critical incidents' }));
      await userEvent.click(group.getByRole('switch', { name: 'Single-key shortcuts' }));
      await userEvent.click(group.getByRole('switch', { name: 'Compact layout' }));

      expect(useConsole.getState().criticalSound).toBe(true);
      expect(useConsole.getState().keyboardShortcuts).toBe(false);
      expect(useConsole.getState().density).toBe('compact');
      expect(group.getByRole('switch', { name: 'Compact layout' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });

    it('closes on Escape and gives focus back to the Settings button', async () => {
      renderWithQueryClient(<StatusBar />);
      await open();

      await userEvent.keyboard('{Escape}');

      expect(panel()).toBeNull();
      expect(settingsButton()).toHaveFocus();
    });

    it('opens the shortcuts help from the panel, closed first, focus on the Settings button', async () => {
      renderWithQueryClient(<StatusBar />);
      await open();

      await userEvent.click(within(panel()!).getByRole('button', { name: 'Keyboard shortcuts' }));

      expect(useConsole.getState().shortcutHelpOpen).toBe(true);
      expect(panel()).toBeNull();
      expect(settingsButton()).toHaveFocus();
    });

    it('shows the help key only while the single-key shortcuts are on', async () => {
      renderWithQueryClient(<StatusBar />);
      await open();
      const help = () => within(panel()!).getByRole('button', { name: 'Keyboard shortcuts' });
      expect(help()).toHaveAttribute('aria-keyshortcuts', '?');

      await userEvent.click(within(panel()!).getByRole('switch', { name: 'Single-key shortcuts' }));

      expect(help()).not.toHaveAttribute('aria-keyshortcuts');
    });

    it.each(ROLES)('is offered to a %s: these are display preferences', async (role) => {
      useSession.setState({ status: 'signed-in', user: { displayName: 'Test', roles: [role] } });
      renderWithQueryClient(<StatusBar />);

      await open();

      expect(within(panel()!).getAllByRole('switch')).toHaveLength(3);
    });

    it('leaves the summary as the only live region while it is open', async () => {
      renderWithQueryClient(<StatusBar />);

      await open();

      expect(within(bar()).getAllByRole('status')).toEqual([summary()]);
    });

    it('has no axe violations open', async () => {
      renderWithQueryClient(<StatusBar />);

      await open();

      await expectNoAxeViolations();
    });
  });

  it('has no axe violations, healthy or degraded', async () => {
    allGood();
    renderWithQueryClient(<StatusBar />);
    await expectNoAxeViolations();

    act(() => useConsole.getState().setConnection('offline'));
    await expectNoAxeViolations();
  });
});
