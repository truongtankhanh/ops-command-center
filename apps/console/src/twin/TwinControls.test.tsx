import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import type { Mock } from 'vitest';
import { registerTwinCommands, type TwinCommands } from '../lib/twin-core/twinCommands';
import { useConsole } from '../store';
import { expectNoAxeViolations, resetStore } from '../test-utils';
import { TwinControls } from './TwinControls';

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

describe('TwinControls', () => {
  let rig: FakeCommands;
  let unregister: () => void;

  beforeEach(() => {
    resetStore(useConsole);
    rig = fakeCommands();
    unregister = registerTwinCommands(rig);
  });

  afterEach(() => unregister());

  it('offers the compass and five camera buttons, each a button with a name', () => {
    render(<TwinControls compassRef={createRef()} />);

    const group = screen.getByRole('group', { name: 'Camera' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Zoom in', 'Zoom out', 'Rotate left', 'Rotate right', 'Reset view']);
    expect(screen.getByRole('button', { name: 'Face north' })).toBeInTheDocument();
  });

  describe('the drag tool (V3-29)', () => {
    it('is a pair of toggle buttons, Orbit pressed first', () => {
      render(<TwinControls compassRef={createRef()} />);

      const group = screen.getByRole('group', { name: 'Drag tool' });
      const [orbit, pan] = within(group).getAllByRole('button');
      expect(orbit).toHaveAccessibleName('Orbit: drag rotates');
      expect(pan).toHaveAccessibleName('Pan: drag moves the view');
      expect(orbit).toHaveAttribute('aria-pressed', 'true');
      expect(pan).toHaveAttribute('aria-pressed', 'false');
    });

    it('switches to Pan and back, and the store holds the choice', async () => {
      render(<TwinControls compassRef={createRef()} />);

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
      const { rerender } = render(<TwinControls compassRef={createRef()} />);
      const pan = () => screen.getByRole('button', { name: 'Pan: drag moves the view' });
      expect(pan()).toHaveAttribute('aria-keyshortcuts', 'P');

      act(() => useConsole.setState({ keyboardShortcuts: false }));
      rerender(<TwinControls compassRef={createRef()} />);

      expect(pan()).not.toHaveAttribute('aria-keyshortcuts');
    });
  });

  it('zooms in to 0.8 of the distance and out to 1.25 of it', async () => {
    render(<TwinControls compassRef={createRef()} />);

    await press('Zoom in');
    await press('Zoom out');

    expect(rig.zoomBy.mock.calls).toEqual([[0.8], [1.25]]);
  });

  it('turns the view by 30°, left the positive way', async () => {
    render(<TwinControls compassRef={createRef()} />);

    await press('Rotate left');
    await press('Rotate right');

    expect(rig.rotateBy.mock.calls).toEqual([[30], [-30]]);
  });

  it('resets to the home view', async () => {
    render(<TwinControls compassRef={createRef()} />);

    await press('Reset view');

    expect(rig.home).toHaveBeenCalledTimes(1);
  });

  it('also goes back to the campus level: the asset is deselected and the building left', async () => {
    useConsole.getState().selectAsset('CT-01', 'dc');
    render(<TwinControls compassRef={createRef()} />);

    await press('Reset view');

    expect(useConsole.getState().selectedAssetCode).toBeNull();
    expect(useConsole.getState().focusZoneId).toBeNull();
    expect(rig.home).toHaveBeenCalledTimes(1);
  });

  it('keeps an open incident when it resets', async () => {
    useConsole.getState().select('a');
    useConsole.getState().focusBuilding('dc');
    render(<TwinControls compassRef={createRef()} />);

    await press('Reset view');

    expect(useConsole.getState().selectedIncidentId).toBe('a');
    expect(useConsole.getState().focusZoneId).toBeNull();
  });

  it('flies home even when it was at the campus level already', async () => {
    render(<TwinControls compassRef={createRef()} />);

    await press('Reset view');
    await press('Reset view');

    expect(rig.home).toHaveBeenCalledTimes(2);
  });

  it('faces north from the compass, in one press', async () => {
    render(<TwinControls compassRef={createRef()} />);

    await press('Face north');

    expect(rig.faceNorth).toHaveBeenCalledTimes(1);
  });

  it('hands its compass to the ref, so the canvas can turn and rename it', () => {
    const compassRef = createRef<HTMLButtonElement>();
    render(<TwinControls compassRef={compassRef} />);

    expect(compassRef.current).toBe(screen.getByRole('button', { name: 'Face north' }));
    expect(compassRef.current?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('does nothing, and does not throw, while no rig is registered', async () => {
    unregister();
    render(<TwinControls compassRef={createRef()} />);

    await press('Zoom in');
    await press('Reset view');
    await press('Face north');

    expect(rig.zoomBy).not.toHaveBeenCalled();
    expect(rig.home).not.toHaveBeenCalled();
    expect(rig.faceNorth).not.toHaveBeenCalled();
  });

  it('is reachable by keyboard and presses on Enter', async () => {
    const user = userEvent.setup();
    render(<TwinControls compassRef={createRef()} />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Face north' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(rig.faceNorth).toHaveBeenCalledTimes(1);
  });

  // Moving the camera is not an action on the site: the cluster reads no session and no permission, so it
  // renders here with neither, and so for every role.
  it('has no accessibility violations', async () => {
    render(<TwinControls compassRef={createRef()} />);

    await expectNoAxeViolations();
  });
});
