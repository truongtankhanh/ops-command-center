import type { Asset, LngLat, Role, Zone } from '@occ/contracts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type RefObject } from 'react';
import type { Mock } from 'vitest';
import { queryKeys } from '../api/queries';
import { useSession } from '../auth/store';
import { offsetM } from '../lib/map/geo';
import { registerTwinCommands, type TwinCommands } from '../lib/twin-core/twinCommands';
import type * as TwinFocus from '../lib/twin-core/twinFocus';
import { focusSelection } from '../lib/twin-core/twinFocus';
import { useConsole } from '../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../test-utils';
import { TwinControls } from './TwinControls';

// "Focus" asks the canvas to fly; there is none here, so only the request is observed. The rule that shows the
// button (`focusAvailable`) stays real.
vi.mock('../lib/twin-core/twinFocus', async (importOriginal) => ({
  ...(await importOriginal<typeof TwinFocus>()),
  focusSelection: vi.fn(),
}));

type FakeCommands = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };

function fakeCommands(): FakeCommands {
  return {
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
  };
}

const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));

const CENTER: LngLat = [108.4415, 11.953];

/** A 60 × 46 m building, 14 m tall, centred on `CENTER`. */
const BUILDING: Zone = {
  id: 'BLD-DC',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  heightM: 14,
  polygon: [
    offsetM(CENTER, -30, -23),
    offsetM(CENTER, 30, -23),
    offsetM(CENTER, 30, 23),
    offsetM(CENTER, -30, 23),
    offsetM(CENTER, -30, -23),
  ],
  center: CENTER,
};

/** 200 m from the building, so the scene always draws it. */
const OUTDOOR = {
  id: 'asset-gen-01',
  code: 'GEN-01',
  name: 'Generator',
  zoneId: BUILDING.id,
  position: offsetM(CENTER, 200, 0),
  elevationM: 0,
} as Asset;

/** The rail reads the catalogue and the zones for its Focus button, so it needs the query provider. */
function renderRail(compassRef: RefObject<HTMLButtonElement | null> = createRef()) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, [OUTDOOR]);
  client.setQueryData(queryKeys.zones, [BUILDING]);
  return renderWithQueryClient(<TwinControls compassRef={compassRef} />, client);
}

const focusButton = () => screen.queryByRole('button', { name: 'Focus' });

describe('TwinControls', () => {
  let rig: FakeCommands;
  let unregister: () => void;

  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    vi.mocked(focusSelection).mockClear();
    rig = fakeCommands();
    unregister = registerTwinCommands(rig);
  });

  afterEach(() => unregister());

  it('offers the compass and five camera buttons, each a button with a name', () => {
    renderRail();

    const group = screen.getByRole('group', { name: 'Camera' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Zoom in', 'Zoom out', 'Rotate left', 'Rotate right', 'Reset view']);
    expect(screen.getByRole('button', { name: 'Face north' })).toBeInTheDocument();
  });

  // V3-10.2: the controls are one floating panel down the left edge, in the order they have always been tabbed to.
  describe('the rail (V3-10.2)', () => {
    it('is one floating panel that holds every control', () => {
      renderRail();

      const rail = screen
        .getByRole('button', { name: 'Face north' })
        .closest<HTMLElement>('[data-variant="floating"]');
      expect(rail).not.toBeNull();
      expect(rail).toContainElement(screen.getByRole('group', { name: 'Drag tool' }));
      expect(rail).toContainElement(screen.getByRole('group', { name: 'Camera' }));
      expect(document.querySelectorAll('[data-variant="floating"]')).toHaveLength(1);
    });

    it('is tabbed in order: the compass, Orbit, Pan, Zoom in, Zoom out, Rotate left, Rotate right, Reset view', async () => {
      const user = userEvent.setup();
      renderRail();

      for (const name of [
        'Face north',
        'Orbit: drag rotates',
        'Pan: drag moves the view',
        'Zoom in',
        'Zoom out',
        'Rotate left',
        'Rotate right',
        'Reset view',
      ]) {
        await user.tab();
        expect(screen.getByRole('button', { name })).toHaveFocus();
      }
    });
  });

  // V3-10.2: the rail's second entry for the inspector foot's "Focus": the same rule (`focusAvailable`) and the same
  // command (`focusSelection`), in the 3D view only, for an asset or a part, whatever the role.
  describe('Focus', () => {
    const in3d = (state: Partial<ReturnType<typeof useConsole.getState>> = {}) =>
      useConsole.setState({ view: '3d', selectedAssetCode: OUTDOOR.code, ...state });

    it('is not offered with nothing selected', () => {
      useConsole.setState({ view: '3d' });
      renderRail();

      expect(focusButton()).toBeNull();
      expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
    });

    it('is not offered for an incident with no asset selected', () => {
      useConsole.setState({ view: '3d', selectedIncidentId: 'incident-1' });
      renderRail();

      expect(focusButton()).toBeNull();
    });

    it('is not offered in the 2D view', () => {
      in3d({ view: '2d' });
      renderRail();

      expect(focusButton()).toBeNull();
    });

    it('is not offered for an asset the catalogue does not hold', () => {
      in3d({ selectedAssetCode: 'NOPE-01' });
      renderRail();

      expect(focusButton()).toBeNull();
    });

    it('is offered last, in its own group, with an asset selected', () => {
      in3d();
      renderRail();

      const group = screen.getByRole('group', { name: 'Selection' });
      expect(within(group).getAllByRole('button')).toEqual([focusButton()]);
      // After the camera group in the DOM, so after it in the tab order; the camera group is still five buttons.
      const camera = screen.getByRole('group', { name: 'Camera' });
      expect(camera.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(camera).getAllByRole('button')).toHaveLength(5);
    });

    it('is offered with a part selected, and flies to that part', async () => {
      in3d({ selectedPart: 'Fan' });
      renderRail();

      await press('Focus');

      expect(focusSelection).toHaveBeenCalledExactlyOnceWith('GEN-01', 'Fan');
    });

    it('flies to the asset when no part is selected', async () => {
      in3d();
      renderRail();

      await press('Focus');

      expect(focusSelection).toHaveBeenCalledExactlyOnceWith('GEN-01', null);
    });

    it.each<Role>(['viewer', 'technician', 'operator', 'supervisor'])(
      'is offered to a %s, since moving the camera is not an action on the site',
      (role) => {
        useSession.getState().signedIn({ displayName: 'Someone', roles: [role] });
        in3d();
        renderRail();

        expect(focusButton()).toBeInTheDocument();
      },
    );

    it('comes and goes with the selection', () => {
      in3d();
      renderRail();
      expect(focusButton()).toBeInTheDocument();

      act(() => useConsole.setState({ selectedAssetCode: null }));

      expect(focusButton()).toBeNull();
    });

    it('names the F key only while single-key shortcuts are on', () => {
      in3d();
      renderRail();
      expect(focusButton()).toHaveAttribute('aria-keyshortcuts', 'F');

      act(() => useConsole.setState({ keyboardShortcuts: false }));

      expect(focusButton()).not.toHaveAttribute('aria-keyshortcuts');
    });

    it('has no accessibility violations while it is offered', async () => {
      in3d({ selectedPart: 'Fan' });
      renderRail();

      await expectNoAxeViolations();
    });
  });

  describe('the drag tool (V3-29)', () => {
    it('is a pair of toggle buttons, Orbit pressed first', () => {
      renderRail();

      const group = screen.getByRole('group', { name: 'Drag tool' });
      const [orbit, pan] = within(group).getAllByRole('button');
      expect(orbit).toHaveAccessibleName('Orbit: drag rotates');
      expect(pan).toHaveAccessibleName('Pan: drag moves the view');
      expect(orbit).toHaveAttribute('aria-pressed', 'true');
      expect(pan).toHaveAttribute('aria-pressed', 'false');
    });

    it('switches to Pan and back, and the store holds the choice', async () => {
      renderRail();

      await press('Pan: drag moves the view');
      expect(useConsole.getState().panTool).toBe(true);
      expect(screen.getByRole('button', { name: 'Pan: drag moves the view' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Orbit: drag rotates' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      await press('Orbit: drag rotates');
      expect(useConsole.getState().panTool).toBe(false);
    });

    it('names the P key only while single-key shortcuts are on', () => {
      renderRail();
      const pan = () => screen.getByRole('button', { name: 'Pan: drag moves the view' });
      expect(pan()).toHaveAttribute('aria-keyshortcuts', 'P');

      act(() => useConsole.setState({ keyboardShortcuts: false }));

      expect(pan()).not.toHaveAttribute('aria-keyshortcuts');
    });
  });

  it('zooms in to 0.8 of the distance and out to 1.25 of it', async () => {
    renderRail();

    await press('Zoom in');
    await press('Zoom out');

    expect(rig.zoomBy.mock.calls).toEqual([[0.8], [1.25]]);
  });

  it('turns the view by 30°, left the positive way', async () => {
    renderRail();

    await press('Rotate left');
    await press('Rotate right');

    expect(rig.rotateBy.mock.calls).toEqual([[30], [-30]]);
  });

  it('resets to the home view', async () => {
    renderRail();

    await press('Reset view');

    expect(rig.home).toHaveBeenCalledTimes(1);
  });

  it('also goes back to the campus level: the asset is deselected and the building left', async () => {
    useConsole.getState().selectAsset('CT-01', 'dc');
    renderRail();

    await press('Reset view');

    expect(useConsole.getState().selectedAssetCode).toBeNull();
    expect(useConsole.getState().focusZoneId).toBeNull();
    expect(rig.home).toHaveBeenCalledTimes(1);
  });

  it('keeps an open incident when it resets', async () => {
    useConsole.getState().select('a');
    useConsole.getState().focusBuilding('dc');
    renderRail();

    await press('Reset view');

    expect(useConsole.getState().selectedIncidentId).toBe('a');
    expect(useConsole.getState().focusZoneId).toBeNull();
  });

  it('flies home even when it was at the campus level already', async () => {
    renderRail();

    await press('Reset view');
    await press('Reset view');

    expect(rig.home).toHaveBeenCalledTimes(2);
  });

  it('faces north from the compass, in one press', async () => {
    renderRail();

    await press('Face north');

    expect(rig.faceNorth).toHaveBeenCalledTimes(1);
  });

  it('hands its compass to the ref, so the canvas can turn and rename it', () => {
    const compassRef = createRef<HTMLButtonElement>();
    renderRail(compassRef);

    expect(compassRef.current).toBe(screen.getByRole('button', { name: 'Face north' }));
    expect(compassRef.current?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('does nothing, and does not throw, while no rig is registered', async () => {
    unregister();
    renderRail();

    await press('Zoom in');
    await press('Reset view');
    await press('Face north');

    expect(rig.zoomBy).not.toHaveBeenCalled();
    expect(rig.home).not.toHaveBeenCalled();
    expect(rig.faceNorth).not.toHaveBeenCalled();
  });

  it('is reachable by keyboard and presses on Enter', async () => {
    const user = userEvent.setup();
    renderRail();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Face north' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(rig.faceNorth).toHaveBeenCalledTimes(1);
  });

  // Moving the camera is not an action on the site: the cluster reads no session and no permission, so it
  // renders here with neither, and so for every role.
  it('has no accessibility violations', async () => {
    renderRail();

    await expectNoAxeViolations();
  });
});
