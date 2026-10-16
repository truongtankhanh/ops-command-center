import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConsole } from '../store';
import { expectNoAxeViolations, resetStore, stubTwinAvailable, unstubTwin } from '../test-utils';
import { ViewSwitch } from './ViewSwitch';

const KEY = 'occ.console.view';
const NOT_BUILT = "3D view isn't available in this version";

const view3d = () => screen.getByRole('button', { name: '3D' });
const view2d = () => screen.getByRole('button', { name: '2D' });

describe('ViewSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore(useConsole);
  });

  it('offers both views in a group, with 2D pressed', () => {
    render(<ViewSwitch />);

    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
    expect(view2d()).toHaveAttribute('aria-pressed', 'true');
    expect(view3d()).toHaveAttribute('aria-pressed', 'false');
  });

  it('describes 3D as unavailable, and says why', () => {
    render(<ViewSwitch />);

    expect(view3d()).toHaveAttribute('aria-disabled', 'true');
    expect(view3d()).toHaveAccessibleDescription(NOT_BUILT);
  });

  it('keeps 3D reachable by keyboard: it is aria-disabled, not disabled', async () => {
    const user = userEvent.setup();
    render(<ViewSwitch />);

    expect(view3d()).not.toBeDisabled();

    await user.tab();
    expect(view3d()).toHaveFocus();
    await user.tab();
    expect(view2d()).toHaveFocus();
  });

  it('does nothing when 3D is pressed, and remembers nothing', async () => {
    const user = userEvent.setup();
    render(<ViewSwitch />);

    await user.click(view3d());

    expect(useConsole.getState().view).toBe('2d');
    expect(view2d()).toHaveAttribute('aria-pressed', 'true');
    expect(view3d()).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('remembers 2D when it is chosen', async () => {
    const user = userEvent.setup();
    render(<ViewSwitch />);

    await user.click(view2d());

    expect(localStorage.getItem(KEY)).toBe('2d');
  });

  // The twin is offered (gate open, WebGL 2 stubbed), as in `pnpm dev`, then its context is lost.
  describe('where the twin can be drawn', () => {
    beforeEach(() => {
      stubTwinAvailable();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      unstubTwin();
    });

    it('lets 3D be chosen', async () => {
      const user = userEvent.setup();
      render(<ViewSwitch />);

      expect(view3d()).not.toHaveAttribute('aria-disabled');
      await user.click(view3d());

      expect(view3d()).toHaveAttribute('aria-pressed', 'true');
      expect(view2d()).toHaveAttribute('aria-pressed', 'false');
    });

    it('turns 3D off, on 2D, with the reason, when the context is lost', () => {
      act(() => useConsole.getState().setView('3d'));
      render(<ViewSwitch />);
      expect(view3d()).toHaveAttribute('aria-pressed', 'true');

      act(() => useConsole.getState().markTwinLost());

      expect(view3d()).toHaveAttribute('aria-disabled', 'true');
      expect(view3d()).toHaveAccessibleDescription('3D view stopped working');
      expect(view2d()).toHaveAttribute('aria-pressed', 'true');
      expect(localStorage.getItem(KEY)).toBe('3d');
    });
  });

  // Choosing a view is not an action on the site: the switch reads no session and no permission,
  // so it renders here with neither, and so for every role.
  it('has no accessibility violations', async () => {
    render(<ViewSwitch />);

    await expectNoAxeViolations();
  });
});
