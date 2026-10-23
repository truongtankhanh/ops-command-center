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
    expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull();
  });

  it('hides one layer and leaves the others', async () => {
    const user = userEvent.setup();
    render(<LayersControl />);

    await user.click(toggle('Cameras'));

    expect(toggle('Cameras')).toHaveAttribute('aria-pressed', 'false');
    expect(toggle('Incidents')).toHaveAttribute('aria-pressed', 'true');
    expect(toggle('Assets')).toHaveAttribute('aria-pressed', 'true');
    expect(layers()).toEqual({
      incidents: true,
      cameras: false,
      assets: true,
      inside: true,
      heat: false,
    });
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

  describe('in the 3D view', () => {
    it('offers Incidents, Cameras and Heat, and no Assets', () => {
      render(<LayersControl view="3d" />);

      expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
      expect(toggle('Incidents')).toHaveAttribute('aria-pressed', 'true');
      expect(toggle('Cameras')).toHaveAttribute('aria-pressed', 'true');
      expect(toggle('Heat')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByRole('button', { name: 'Assets' })).toBeNull();
    });

    it('is the 2D control when no view is given', () => {
      render(<LayersControl />);

      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
        'Incidents',
        'Cameras',
        'Assets',
      ]);
    });

    describe('Heat (V2-17.4)', () => {
      it('is off at each start and last in the list', () => {
        render(<LayersControl view="3d" />);

        expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
          'Incidents',
          'Cameras',
          'Heat',
        ]);
        expect(toggle('Heat')).toHaveAttribute('aria-pressed', 'false');
        expect(layers().heat).toBe(false);
      });

      it('turns on and off through the store and leaves the other layers as they were', async () => {
        const user = userEvent.setup();
        render(<LayersControl view="3d" />);

        await user.click(toggle('Heat'));

        expect(toggle('Heat')).toHaveAttribute('aria-pressed', 'true');
        expect(layers()).toEqual({
          incidents: true,
          cameras: true,
          assets: true,
          inside: true,
          heat: true,
        });

        await user.click(toggle('Heat'));

        expect(toggle('Heat')).toHaveAttribute('aria-pressed', 'false');
        expect(layers().heat).toBe(false);
      });

      it('is reachable by keyboard and toggles on Space', async () => {
        const user = userEvent.setup();
        render(<LayersControl view="3d" />);

        await user.tab();
        await user.tab();
        await user.tab();
        expect(toggle('Heat')).toHaveFocus();
        await user.keyboard(' ');

        expect(layers().heat).toBe(true);
      });

      it('stays offered with its state at asset and part level, where it draws nothing different', () => {
        act(() => useConsole.getState().toggleLayer('heat'));
        render(<LayersControl view="3d" />);

        act(() => useConsole.getState().selectAsset('UPS-01', 'BLD-DC'));
        expect(toggle('Heat')).toHaveAttribute('aria-pressed', 'true');

        act(() => useConsole.getState().selectPart('Door'));
        expect(toggle('Heat')).toHaveAttribute('aria-pressed', 'true');
      });

      it('is not offered in the 2D view, and 2D keeps its three layers', () => {
        act(() => useConsole.getState().toggleLayer('heat'));
        render(<LayersControl view="2d" />);

        expect(screen.queryByRole('button', { name: 'Heat' })).toBeNull();
        expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
          'Incidents',
          'Cameras',
          'Assets',
        ]);
      });

      it('has no accessibility violations, with Heat on too', async () => {
        render(<LayersControl view="3d" />);
        act(() => useConsole.getState().toggleLayer('heat'));

        await expectNoAxeViolations();
      });
    });

    it('hides the cameras through the same store as the 2D map', async () => {
      const user = userEvent.setup();
      render(<LayersControl view="3d" />);

      await user.click(toggle('Cameras'));

      expect(toggle('Cameras')).toHaveAttribute('aria-pressed', 'false');
      expect(layers()).toEqual({
        incidents: true,
        cameras: false,
        assets: true,
        inside: true,
        heat: false,
      });
    });

    it('leaves the Assets layer as it was, and offers it again in 2D', async () => {
      const user = userEvent.setup();
      act(() => useConsole.getState().toggleLayer('assets'));
      const { rerender } = render(<LayersControl view="3d" />);

      await user.click(toggle('Cameras'));
      expect(layers().assets).toBe(false);

      rerender(<LayersControl view="2d" />);

      expect(toggle('Assets')).toHaveAttribute('aria-pressed', 'false');
      expect(toggle('Cameras')).toHaveAttribute('aria-pressed', 'false');
    });

    it('still says in words that the incidents are hidden', async () => {
      const user = userEvent.setup();
      render(<LayersControl view="3d" />);

      await user.click(toggle('Incidents'));

      expect(screen.getByText('Incidents hidden')).toBeInTheDocument();
      expect(toggle('Incidents')).toHaveAccessibleDescription('Incidents hidden');
    });

    it('has no accessibility violations', async () => {
      render(<LayersControl view="3d" />);

      await expectNoAxeViolations();
    });

    describe('at building level (V2-15.9)', () => {
      beforeEach(() => act(() => useConsole.getState().focusBuilding('BLD-DC')));

      it('adds Inside after Cameras and before Heat, shown', () => {
        render(<LayersControl view="3d" />);

        expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
          'Incidents',
          'Cameras',
          'Inside',
          'Heat',
        ]);
        expect(toggle('Inside')).toHaveAttribute('aria-pressed', 'true');
      });

      it('hides Inside through the store and leaves the others', async () => {
        const user = userEvent.setup();
        render(<LayersControl view="3d" />);

        await user.click(toggle('Inside'));

        expect(toggle('Inside')).toHaveAttribute('aria-pressed', 'false');
        expect(toggle('Cameras')).toHaveAttribute('aria-pressed', 'true');
        expect(layers()).toEqual({
          incidents: true,
          cameras: true,
          assets: true,
          inside: false,
          heat: false,
        });
      });

      it('is reachable by keyboard and toggles on Space', async () => {
        const user = userEvent.setup();
        render(<LayersControl view="3d" />);

        await user.tab();
        await user.tab();
        await user.tab();
        expect(toggle('Inside')).toHaveFocus();
        await user.keyboard(' ');

        expect(layers().inside).toBe(false);
      });

      it('does not offer it at campus, asset or part level, and keeps its state', () => {
        act(() => useConsole.getState().toggleLayer('inside'));
        render(<LayersControl view="3d" />);
        expect(toggle('Inside')).toHaveAttribute('aria-pressed', 'false');

        act(() => useConsole.getState().selectAsset('UPS-01', 'BLD-DC'));
        expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull();

        act(() => useConsole.getState().selectPart('Door'));
        expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull();

        act(() => useConsole.getState().goCampus());
        expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull();

        act(() => useConsole.getState().focusBuilding('BLD-DC'));
        expect(toggle('Inside')).toHaveAttribute('aria-pressed', 'false');
      });

      it('is not offered in the 2D view, whatever the level', () => {
        render(<LayersControl view="2d" />);

        expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull();
      });

      it('has no accessibility violations', async () => {
        render(<LayersControl view="3d" />);

        await expectNoAxeViolations();
      });
    });
  });
});
