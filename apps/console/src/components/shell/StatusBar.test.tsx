import { ROLES } from '@occ/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from '../../auth/store';
import type * as CriticalCue from '../../lib/incidents/criticalCue';
import { unlockAudio } from '../../lib/incidents/criticalCue';
import { CONNECTION_LABEL, TELEMETRY_LABEL } from '../../lib/shell/connectionLabels';
import { initialTelemetryState, type TelemetryPillState } from '../../lib/telemetry/telemetryState';
import { TWIN_UNAVAILABLE_COPY } from '../../lib/twin-core/twinCapability';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import { expectNoAxeViolations, resetStore, stubTwinAvailable, unstubTwin } from '../../test-utils';
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
const segment = (id: 'engine' | 'events' | 'telemetry') =>
  bar().querySelector<HTMLElement>(`[data-segment="${id}"]`)!;

describe('StatusBar', () => {
  // The stores are module-level singletons: without a reset, one case's state leaks into the next.
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    holdTelemetry('connecting');
  });
  afterEach(unstubTwin);

  it('is the console\'s footer, named "System status"', () => {
    render(<StatusBar />);

    expect(bar()).toBeInTheDocument();
  });

  describe('when everything is good', () => {
    it('says the system is healthy, with the three states behind it', () => {
      allGood();
      render(<StatusBar />);

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
      render(<StatusBar />);

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
        render(<StatusBar />);

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
        render(<StatusBar />);

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
        render(<StatusBar />);

        act(() => useConsole.getState().markTwinLost(fault));

        expect(bar()).toHaveAttribute('data-level', 'degraded');
        expect(summary()).toHaveTextContent(TWIN_UNAVAILABLE_COPY[fault].title);
        expect(segment('engine')).toHaveTextContent(TWIN_UNAVAILABLE_COPY[fault].title);
        expect(segment('engine')).toHaveAttribute('data-state', 'warn');
      },
    );

    it('says the session expired, with every segment still fine', () => {
      allGood();
      render(<StatusBar />);

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
      render(<StatusBar />);

      expect(bar()).toHaveAttribute('data-level', 'healthy');
      expect(summary()).toHaveTextContent('System healthy');
      expect(segment('engine')).toHaveTextContent(TWIN_UNAVAILABLE_COPY['no-webgl2'].title);
      expect(segment('engine')).toHaveAttribute('data-state', 'off');
    });

    it('does not call a link being made a problem', () => {
      allGood();
      act(() => useConsole.getState().setConnection('connecting'));
      holdTelemetry('connecting');
      render(<StatusBar />);

      expect(bar()).toHaveAttribute('data-level', 'healthy');
      expect(segment('events')).toHaveTextContent(CONNECTION_LABEL.connecting);
      expect(segment('telemetry')).toHaveTextContent(TELEMETRY_LABEL.connecting);
    });
  });

  describe('when several things are wrong', () => {
    it('summarises the first in the order session, events, telemetry, engine, and shows every state', () => {
      allGood();
      render(<StatusBar />);

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
      render(<StatusBar />);
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
      render(<StatusBar />);

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
      render(<StatusBar />);
      const before = summary();

      act(() => useConsole.getState().setConnection('offline'));

      expect(summary()).toBe(before);
      expect(before).toHaveTextContent(CONNECTION_LABEL.offline);
    });
  });

  describe('what it leaves out', () => {
    it('draws one action, Settings, and no FPS or bare number', () => {
      allGood();
      render(<StatusBar />);

      // The segments are text; the only control is the Settings button, and its switches are in the closed panel.
      expect(within(bar()).getAllByRole('button')).toEqual([
        within(bar()).getByRole('button', { name: 'Settings' }),
      ]);
      for (const role of ['link', 'switch', 'checkbox', 'menuitem'] as const) {
        expect(within(bar()).queryAllByRole(role), role).toHaveLength(0);
      }
      const text = bar().textContent ?? '';
      expect(text).not.toMatch(/fps/i);
      expect(text).not.toMatch(/(^|\s)\d+([.,]\d+)?(\s|$)/);
    });

    it.each(ROLES)(
      'is the same for a %s: reading the state is not an action on the site',
      (role) => {
        useSession.setState({ status: 'signed-in', user: { displayName: 'Test', roles: [role] } });
        allGood();
        render(<StatusBar />);

        expect(bar()).toHaveAttribute('data-level', 'healthy');
        expect(summary()).toHaveTextContent('System healthy');
        expect(segment('events')).toHaveTextContent('Events Live');
      },
    );
  });

  // V3-06.4: the video wall's foot. The console's sentence and segments, with nothing to press (`WallApp.test.tsx` mounts it there).
  describe('read-only (the video wall)', () => {
    const INTERACTIVE =
      'button, a[href], input, select, textarea, summary, [tabindex], [role="button"]';

    it('says what the console does, with nothing to press or tab to', () => {
      allGood();
      render(<StatusBar readOnly />);

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
      render(<StatusBar readOnly />);

      expect(within(bar()).queryByRole('button', { name: 'Settings' })).toBeNull();
      expect(summary()).toHaveTextContent('System healthy');
    });

    it("says a lost events link and paused telemetry in the console's words", () => {
      allGood();
      render(<StatusBar readOnly />);

      act(() => useConsole.getState().setConnection('offline'));
      holdTelemetry('paused');

      expect(bar()).toHaveAttribute('data-level', 'degraded');
      expect(summary()).toHaveTextContent(CONNECTION_LABEL.offline);
      expect(segment('events')).toHaveTextContent(CONNECTION_LABEL.offline);
      expect(segment('telemetry')).toHaveTextContent(TELEMETRY_LABEL.paused);
    });

    it('keeps the summary as the only live region', () => {
      allGood();
      render(<StatusBar readOnly />);

      expect(within(bar()).getAllByRole('status')).toEqual([summary()]);
    });

    it("reads 3D view on a wall whatever 2D/3D choice is stored for the console's operators", () => {
      allGood();
      act(() => useConsole.setState({ wall: 2, view: '2d' }));
      render(<StatusBar readOnly />);

      expect(segment('engine')).toHaveTextContent('3D 3D view');
      expect(segment('engine')).toHaveAttribute('data-state', 'ok');
      expect(bar()).toHaveAttribute('data-level', 'healthy');
    });

    it('still says a 3D fault on a wall, in the fallback banner’s words', () => {
      allGood();
      act(() => useConsole.setState({ wall: 2 }));
      render(<StatusBar readOnly />);

      act(() => useConsole.getState().markTwinLost('too-slow'));

      expect(bar()).toHaveAttribute('data-level', 'degraded');
      expect(summary()).toHaveTextContent(TWIN_UNAVAILABLE_COPY['too-slow'].title);
      expect(segment('engine')).toHaveAttribute('data-state', 'warn');
    });

    it('has no axe violations, healthy or degraded', async () => {
      allGood();
      render(<StatusBar readOnly />);
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
      render(<StatusBar />);

      expect(settingsButton()).toHaveAttribute('aria-expanded', 'false');
      expect(panel()).toBeNull();
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });

    it('opens to the three switches and the help button, upward', async () => {
      render(<StatusBar />);

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
      render(<StatusBar />);
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
      render(<StatusBar />);
      await open();

      await userEvent.keyboard('{Escape}');

      expect(panel()).toBeNull();
      expect(settingsButton()).toHaveFocus();
    });

    it('opens the shortcuts help from the panel, closed first, focus on the Settings button', async () => {
      render(<StatusBar />);
      await open();

      await userEvent.click(within(panel()!).getByRole('button', { name: 'Keyboard shortcuts' }));

      expect(useConsole.getState().shortcutHelpOpen).toBe(true);
      expect(panel()).toBeNull();
      expect(settingsButton()).toHaveFocus();
    });

    it('shows the help key only while the single-key shortcuts are on', async () => {
      render(<StatusBar />);
      await open();
      const help = () => within(panel()!).getByRole('button', { name: 'Keyboard shortcuts' });
      expect(help()).toHaveAttribute('aria-keyshortcuts', '?');

      await userEvent.click(within(panel()!).getByRole('switch', { name: 'Single-key shortcuts' }));

      expect(help()).not.toHaveAttribute('aria-keyshortcuts');
    });

    it.each(ROLES)('is offered to a %s: these are display preferences', async (role) => {
      useSession.setState({ status: 'signed-in', user: { displayName: 'Test', roles: [role] } });
      render(<StatusBar />);

      await open();

      expect(within(panel()!).getAllByRole('switch')).toHaveLength(3);
    });

    it('leaves the summary as the only live region while it is open', async () => {
      render(<StatusBar />);

      await open();

      expect(within(bar()).getAllByRole('status')).toEqual([summary()]);
    });

    it('has no axe violations open', async () => {
      render(<StatusBar />);

      await open();

      await expectNoAxeViolations();
    });
  });

  it('has no axe violations, healthy or degraded', async () => {
    allGood();
    render(<StatusBar />);
    await expectNoAxeViolations();

    act(() => useConsole.getState().setConnection('offline'));
    await expectNoAxeViolations();
  });
});
