import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import type { Mock } from 'vitest';
import { registerTwinCommands, type TwinCommands } from '../lib/twinCommands';
import { expectNoAxeViolations } from '../test-utils';
import { TwinControls } from './TwinControls';

type FakeCommands = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };

function fakeCommands(): FakeCommands {
  return {
    flyTo: vi.fn<TwinCommands['flyTo']>(),
    home: vi.fn<TwinCommands['home']>(),
    zoomBy: vi.fn<TwinCommands['zoomBy']>(),
    rotateBy: vi.fn<TwinCommands['rotateBy']>(),
    faceNorth: vi.fn<TwinCommands['faceNorth']>(),
    current: vi.fn<TwinCommands['current']>(() => null),
  };
}

const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));

describe('TwinControls', () => {
  let rig: FakeCommands;
  let unregister: () => void;

  beforeEach(() => {
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
