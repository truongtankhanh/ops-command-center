import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConsole } from '../store';
import { expectNoAxeViolations, resetStore } from '../test-utils';
import { LayersControl } from './LayersControl';

const toggle = (name: string) => screen.getByRole('button', { name });
const layers = () => useConsole.getState().layers;

describe('LayersControl', () => {
  beforeEach(() => resetStore(useConsole));

  it('names its group and offers the three layers, all shown', () => {
    render(<LayersControl />);

    expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
    for (const name of ['Incidents', 'Cameras', 'Assets']) {
      expect(toggle(name)).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('hides one layer and leaves the others', async () => {
    const user = userEvent.setup();
    render(<LayersControl />);

    await user.click(toggle('Cameras'));

    expect(toggle('Cameras')).toHaveAttribute('aria-pressed', 'false');
    expect(toggle('Incidents')).toHaveAttribute('aria-pressed', 'true');
    expect(toggle('Assets')).toHaveAttribute('aria-pressed', 'true');
    expect(layers()).toEqual({ incidents: true, cameras: false, assets: true });
  });

  it('shows the layer again on a second press', async () => {
    const user = userEvent.setup();
    render(<LayersControl />);

    await user.click(toggle('Assets'));
    await user.click(toggle('Assets'));

    expect(toggle('Assets')).toHaveAttribute('aria-pressed', 'true');
  });

  it('is reachable by keyboard and toggles on Space', async () => {
    const user = userEvent.setup();
    render(<LayersControl />);

    await user.tab();
    expect(toggle('Incidents')).toHaveFocus();
    await user.tab();
    expect(toggle('Cameras')).toHaveFocus();
    await user.keyboard(' ');

    expect(layers().cameras).toBe(false);
  });

  it('says in words that the incidents are hidden, and describes the toggle with it', async () => {
    const user = userEvent.setup();
    render(<LayersControl />);
    expect(screen.queryByText('Incidents hidden')).toBeNull();

    await user.click(toggle('Incidents'));

    expect(screen.getByText('Incidents hidden')).toBeInTheDocument();
    expect(toggle('Incidents')).toHaveAccessibleDescription('Incidents hidden');
  });

  it('says nothing when only cameras or assets are hidden', async () => {
    const user = userEvent.setup();
    render(<LayersControl />);

    await user.click(toggle('Cameras'));
    await user.click(toggle('Assets'));

    expect(screen.queryByText('Incidents hidden')).toBeNull();
  });

  it('is not a live region: the note is plain text', async () => {
    const user = userEvent.setup();
    render(<LayersControl />);

    await user.click(toggle('Incidents'));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // A new critical incident, or selecting one, turns the layer back on from outside this control.
  it('follows the store when a layer is turned back on elsewhere', () => {
    render(<LayersControl />);
    act(() => useConsole.getState().toggleLayer('incidents'));
    expect(toggle('Incidents')).toHaveAttribute('aria-pressed', 'false');

    act(() => useConsole.getState().showLayer('incidents'));

    expect(toggle('Incidents')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Incidents hidden')).toBeNull();
  });

  // Choosing what to draw is not an action on the site: the control reads no session and no
  // permission, so it renders here with neither, and so for every role.
  it('has no accessibility violations, with the incidents hidden too', async () => {
    const { rerender } = render(<LayersControl />);
    await expectNoAxeViolations();

    act(() => useConsole.getState().toggleLayer('incidents'));
    rerender(<LayersControl />);
    await expectNoAxeViolations();
  });
});
