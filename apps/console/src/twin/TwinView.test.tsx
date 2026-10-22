import type { Incident, SitePlan } from '@occ/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import { useSession } from '../auth/store';
import { registerTwinCommands, type TwinCommands } from '../lib/twinCommands';
import type { HeatScene } from '../lib/twinHeat';
import { levelOf } from '../lib/twinLevel';
import { TWIN_VIEW_KEYS } from '../lib/twinSummary';
import { useConsole } from '../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../test-utils';
import { TwinView } from './TwinView';

const PLAN: SitePlan = {
  id: 'plan-1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: [108.4415, 11.953],
  features: [],
};

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'id',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'medium',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/**
 * The view with the site's plan and incidents in the cache, as they are once the console has loaded;
 * `null` leaves one of them out of the cache, so its query is still on its way.
 */
function renderView({
  incidents = [],
  plan = PLAN,
  heat = null,
}: { incidents?: Incident[] | null; plan?: SitePlan | null; heat?: HeatScene | null } = {}) {
  const client = createTestQueryClient();
  if (plan) client.setQueryData(queryKeys.sitePlan, plan);
  if (incidents) client.setQueryData(queryKeys.incidents, incidents);
  return renderWithQueryClient(
    <TwinView heat={heat}>
      <p>the picture</p>
    </TwinView>,
    client,
  );
}

const group = () => screen.getByRole('group', { name: /^3D view of/ });

describe('TwinView', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is one focusable group, described as a 3D view, around what it is given', () => {
    renderView();

    expect(group()).toHaveAttribute('aria-roledescription', '3D view');
    expect(group()).toHaveAttribute('tabindex', '0');
    expect(group()).toHaveTextContent('the picture');
  });

  it('is named by the site and the active incidents, then points to the lists', () => {
    renderView({
      incidents: [
        incident({ id: 'a' }),
        incident({ id: 'b', status: 'acknowledged' }),
        incident({ id: 'c', status: 'resolved' }),
      ],
    });

    expect(group()).toHaveAccessibleName(
      '3D view of Langbiang Tech Campus with 2 active incidents. Drag to rotate. The incident list and the Assets tab list everything shown here.',
    );
  });

  it('says "1 active incident" for one and that there are none for none', () => {
    const { unmount } = renderView({ incidents: [incident({})] });
    expect(group()).toHaveAccessibleName(/with 1 active incident\. /);
    unmount();

    renderView({ incidents: [incident({ status: 'resolved' })] });
    expect(group()).toHaveAccessibleName(/with no active incidents\. /);
  });

  it('follows the cached incidents when an event changes them', async () => {
    const { client } = renderView({ incidents: [incident({ id: 'a' })] });
    expect(group()).toHaveAccessibleName(/with 1 active incident\. /);

    act(() => {
      client.setQueryData(queryKeys.incidents, [
        incident({ id: 'a' }),
        incident({ id: 'b', severity: 'critical' }),
      ]);
    });

    // TanStack Query tells its observers a tick later, which a synchronous `act` does not wait for.
    await waitFor(() => expect(group()).toHaveAccessibleName(/with 2 active incidents\. /));
  });

  it('leaves the count out while the incidents are on their way, instead of reading 0', () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));

    renderView({ incidents: null });

    expect(group()).toHaveAccessibleName(
      '3D view of Langbiang Tech Campus. Drag to rotate. The incident list and the Assets tab list everything shown here.',
    );
  });

  it('calls the site "the campus" while the plan is not there', () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));

    renderView({ incidents: [incident({})], plan: null });

    expect(group()).toHaveAccessibleName(/^3D view of the campus with 1 active incident\. /);
  });

  // The summary is read when the group takes focus; a live region would read a count that changed
  // while nobody asked.
  it('is not a live region', () => {
    const { container } = renderView({ incidents: [incident({})] });

    expect(group()).not.toHaveAttribute('aria-live');
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('has no axe violations', async () => {
    renderView({ incidents: [incident({})] });

    await expectNoAxeViolations();
  });

  describe('with the heat overlay (V2-17.3)', () => {
    /** The overlay of a campus whose silent buildings are `silentNames`; only the names are read here. */
    const overlay = (...silentNames: string[]): HeatScene => ({
      colours: new Map(),
      silent: new Set(),
      labels: new Map(),
      silentNames,
      alarmed: new Set(),
      key: silentNames.join(','),
    });
    const SCALE =
      'Campus coloured by indoor temperature per building, 19 to 27 °C; lighter is warmer.';

    it('says what the colours mean, between the incidents and the pointer', () => {
      renderView({ incidents: [incident({})], heat: overlay() });

      expect(group()).toHaveAccessibleName(
        `3D view of Langbiang Tech Campus with 1 active incident. ${SCALE} Drag to rotate. The incident list and the Assets tab list everything shown here.`,
      );
    });

    it('names the buildings that are faded because their sensor is silent', () => {
      renderView({ heat: overlay('Security Office') });

      expect(group()).toHaveAccessibleName(
        /Security Office faded: its sensor is silent\. Drag to rotate/,
      );
    });

    it('is the name it was without the overlay: nothing about colours', () => {
      renderView({ incidents: [incident({})], heat: null });

      expect(group()).not.toHaveAccessibleName(/coloured/);
    });

    it('follows the overlay as it comes and goes', () => {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.sitePlan, PLAN);
      client.setQueryData(queryKeys.incidents, []);
      const view = (heat: HeatScene | null) => (
        <TwinView heat={heat}>
          <p>the picture</p>
        </TwinView>
      );
      const { rerender } = renderWithQueryClient(view(null), client);
      expect(group()).not.toHaveAccessibleName(/coloured/);

      rerender(
        <QueryClientProvider client={client}>{view(overlay('Library'))}</QueryClientProvider>,
      );
      expect(group()).toHaveAccessibleName(/Library faded: its sensor is silent\./);

      rerender(<QueryClientProvider client={client}>{view(null)}</QueryClientProvider>);
      expect(group()).not.toHaveAccessibleName(/coloured/);
    });

    it('has no axe violations', async () => {
      renderView({ heat: overlay('Library', 'Security Office') });

      await expectNoAxeViolations();
    });
  });
});

// V2-18.3: the stage's keys. They are handled on the group, which is what has focus, and nowhere else.
describe('TwinView keys', () => {
  type FakeCommands = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };
  const fakeCommands = (): FakeCommands => ({
    flyTo: vi.fn<TwinCommands['flyTo']>(),
    home: vi.fn<TwinCommands['home']>(),
    fit: vi.fn<TwinCommands['fit']>(),
    fitAsset: vi.fn<TwinCommands['fitAsset']>(),
    flyToIncident: vi.fn<TwinCommands['flyToIncident']>(),
    showAsset: vi.fn<TwinCommands['showAsset']>(),
    zoomBy: vi.fn<TwinCommands['zoomBy']>(),
    rotateBy: vi.fn<TwinCommands['rotateBy']>(),
    tiltBy: vi.fn<TwinCommands['tiltBy']>(),
    panBy: vi.fn<TwinCommands['panBy']>(),
    faceNorth: vi.fn<TwinCommands['faceNorth']>(),
    panStep: vi.fn<TwinCommands['panStep']>(),
    panHold: vi.fn<TwinCommands['panHold']>(),
    centreOn: vi.fn<TwinCommands['centreOn']>(),
    current: vi.fn<TwinCommands['current']>(() => null),
  });

  let rig: FakeCommands;
  let unregister: () => void;

  beforeEach(() => {
    // The single-key switch is remembered in storage; one case turns it off.
    localStorage.clear();
    resetStore(useConsole);
    rig = fakeCommands();
    unregister = registerTwinCommands(rig);
  });

  afterEach(() => {
    unregister();
    resetStore(useSession);
  });

  /** The view, with a stand-in for a list item beside it (a sibling, as the lists are). */
  function renderWithListItem(onListKey: (event: KeyboardEvent) => void = () => undefined) {
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.sitePlan, PLAN);
    client.setQueryData(queryKeys.incidents, []);
    return renderWithQueryClient(
      <>
        <TwinView heat={null}>
          <p>the picture</p>
        </TwinView>
        <button type="button" onKeyDown={(event) => onListKey(event.nativeEvent)}>
          First incident
        </button>
      </>,
      client,
    );
  }

  /** Presses `key` on the focused group; `false` means the page's default was prevented (the key was used). */
  const press = (key: string, init: KeyboardEventInit = {}): boolean =>
    fireEvent.keyDown(group(), { key, ...init });

  const focusGroup = () => act(() => group().focus());

  describe('with the view focused', () => {
    beforeEach(() => {
      renderWithListItem();
      focusGroup();
    });

    it.each([
      ['ArrowLeft', {}, () => expect(rig.rotateBy).toHaveBeenCalledExactlyOnceWith(15)],
      ['ArrowRight', {}, () => expect(rig.rotateBy).toHaveBeenCalledExactlyOnceWith(-15)],
      ['ArrowUp', {}, () => expect(rig.tiltBy).toHaveBeenCalledExactlyOnceWith(-5)],
      ['ArrowDown', {}, () => expect(rig.tiltBy).toHaveBeenCalledExactlyOnceWith(5)],
      [
        'ArrowLeft',
        { shiftKey: true },
        () => expect(rig.panBy).toHaveBeenCalledExactlyOnceWith(-0.1, 0),
      ],
      [
        'ArrowUp',
        { shiftKey: true },
        () => expect(rig.panBy).toHaveBeenCalledExactlyOnceWith(0, 0.1),
      ],
      ['+', {}, () => expect(rig.zoomBy).toHaveBeenCalledExactlyOnceWith(0.8)],
      ['-', {}, () => expect(rig.zoomBy).toHaveBeenCalledExactlyOnceWith(1.25)],
    ] as const)(
      '%s %o moves the camera and keeps the page from scrolling',
      (key, init, expectCall) => {
        const proceeded = press(key, init);

        expectCall();
        expect(proceeded).toBe(false);
      },
    );

    it('resets to the campus view on Home: the level first, then the camera', () => {
      act(() => useConsole.getState().selectAsset('CT-01', 'BLD-DC'));

      const proceeded = press('Home');

      expect(proceeded).toBe(false);
      expect(levelOf(useConsole.getState())).toBe('campus');
      expect(rig.home).toHaveBeenCalledOnce();
    });

    it('goes up one level a press on Escape, and leaves the camera to the level camera', () => {
      act(() => {
        useConsole.getState().selectAsset('CT-01', 'BLD-DC');
        useConsole.getState().selectPart('Fan');
      });

      for (const level of ['asset', 'building', 'campus']) {
        expect(press('Escape')).toBe(false);
        expect(levelOf(useConsole.getState())).toBe(level);
      }
      expect(rig.home).not.toHaveBeenCalled();
      expect(rig.fit).not.toHaveBeenCalled();
    });

    it('does not take an Escape that has nothing to close', () => {
      act(() => useConsole.getState().select('incident-1'));

      const proceeded = press('Escape');

      expect(proceeded).toBe(true);
      expect(useConsole.getState().selectedIncidentId).toBe('incident-1');
    });

    it('does not take a held Home or Escape, but follows a held arrow', () => {
      expect(press('Home', { repeat: true })).toBe(true);
      expect(press('Escape', { repeat: true })).toBe(true);
      expect(rig.home).not.toHaveBeenCalled();

      expect(press('ArrowLeft', { repeat: true })).toBe(false);
      expect(rig.rotateBy).toHaveBeenCalledOnce();
    });

    it.each(['ctrlKey', 'altKey', 'metaKey'] as const)(
      'ignores a key pressed with %s',
      (modifier) => {
        expect(press('ArrowLeft', { [modifier]: true })).toBe(true);
        expect(press('Home', { [modifier]: true })).toBe(true);

        expect(rig.rotateBy).not.toHaveBeenCalled();
        expect(rig.home).not.toHaveBeenCalled();
      },
    );

    it.each(['Tab', 'v', 'f', '?', '/', 'n', 'a', 'r'])(
      'leaves %j alone, so the shortcut that owns it still gets it',
      (key) => {
        expect(press(key)).toBe(true);
      },
    );

    it('is the same with the single-key shortcuts off: they are not character shortcuts', () => {
      act(() => useConsole.getState().setKeyboardShortcuts(false));

      press('ArrowLeft');
      press('Home');

      expect(rig.rotateBy).toHaveBeenCalledOnce();
      expect(rig.home).toHaveBeenCalledOnce();
    });

    it.each(['viewer', 'technician', 'operator'] as const)(
      'is the same for a %s: moving the camera is not an action on the site',
      (role) => {
        act(() => useSession.getState().signedIn({ displayName: 'Someone', roles: [role] }));

        press('ArrowLeft');
        press('+');

        expect(rig.rotateBy).toHaveBeenCalledOnce();
        expect(rig.zoomBy).toHaveBeenCalledOnce();
      },
    );
  });

  describe('with focus elsewhere', () => {
    it('does nothing to the camera for a key on a list item, and leaves it to the list', () => {
      const onListKey = vi.fn<(event: KeyboardEvent) => void>();
      renderWithListItem(onListKey);
      const item = screen.getByRole('button', { name: 'First incident' });
      act(() => item.focus());

      for (const key of ['Home', 'ArrowLeft', 'ArrowDown', 'Escape', '+']) {
        expect(fireEvent.keyDown(item, { key })).toBe(true);
      }

      expect(onListKey).toHaveBeenCalledTimes(5);
      expect(onListKey.mock.calls.every(([event]) => !event.defaultPrevented)).toBe(true);
      for (const command of Object.values(rig)) {
        if (command !== rig.current) expect(command).not.toHaveBeenCalled();
      }
    });

    it('lets Tab leave the view, and the keys do nothing there', async () => {
      renderWithListItem();
      focusGroup();

      await userEvent.tab();

      expect(screen.getByRole('button', { name: 'First incident' })).toHaveFocus();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'ArrowLeft' });
      expect(rig.rotateBy).not.toHaveBeenCalled();
    });
  });

  describe('focus and description', () => {
    it('takes focus on a press on the picture, and does not stop the press', () => {
      renderWithListItem();
      act(() => screen.getByRole('button', { name: 'First incident' }).focus());

      const proceeded = fireEvent.pointerDown(screen.getByText('the picture'));

      expect(proceeded).toBe(true);
      expect(group()).toHaveFocus();
    });

    it('is described by a sentence that names the keys, and its name is still the summary', () => {
      renderWithListItem();

      expect(group()).toHaveAccessibleDescription(TWIN_VIEW_KEYS);
      expect(group()).not.toHaveAccessibleName(/Arrow|Escape/);
      for (const word of ['Arrow', 'Shift', 'Plus and minus', 'Home', 'Escape']) {
        expect(TWIN_VIEW_KEYS).toContain(word);
      }
    });

    it('has no axe violations with the description', async () => {
      renderWithListItem();

      await expectNoAxeViolations();
    });
  });
});
