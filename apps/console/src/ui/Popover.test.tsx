import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { expectNoAxeViolations } from '../test-utils';
import { Popover } from './Popover';

function renderPopover(props: Partial<ComponentProps<typeof Popover>> = {}) {
  return render(
    <>
      <Popover trigger="Account" panelLabel="Account details" {...props}>
        <button type="button">Inside</button>
        <p>Panel text</p>
      </Popover>
      <button type="button">Outside</button>
    </>,
  );
}

const trigger = () => screen.getByRole('button', { name: 'Account' });
/** Role queries skip the hidden panel, so `null` means closed. */
const panel = () => screen.queryByRole('group', { name: 'Account details' });

describe('Popover', () => {
  it('starts closed, with the panel present but empty', () => {
    renderPopover();

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toBeNull();
    // A hidden element has no accessible name (accname step 2A), so it is found by role alone; the
    // label is checked as an attribute instead.
    const hidden = screen.getByRole('group', { hidden: true });
    expect(hidden).toHaveAttribute('aria-label', 'Account details');
    expect(hidden).toHaveAttribute('hidden');
    expect(hidden).toHaveAttribute('id', trigger().getAttribute('aria-controls'));
    expect(screen.queryByRole('button', { name: 'Inside', hidden: true })).toBeNull();
  });

  it('opens on click and keeps focus on its trigger', async () => {
    renderPopover();

    await userEvent.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).toContainElement(screen.getByRole('button', { name: 'Inside' }));
    expect(trigger()).toHaveFocus();
  });

  it('closes on a second click', async () => {
    renderPopover();

    await userEvent.click(trigger());
    await userEvent.click(trigger());

    expect(panel()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and returns focus to its trigger', async () => {
    renderPopover();
    await userEvent.click(trigger());
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');

    expect(panel()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes on a pointer press outside', async () => {
    renderPopover();
    await userEvent.click(trigger());

    fireEvent.pointerDown(document.body);

    expect(panel()).toBeNull();
  });

  it('stays open on a pointer press inside', async () => {
    renderPopover();
    await userEvent.click(trigger());

    fireEvent.pointerDown(screen.getByText('Panel text'));

    expect(panel()).not.toBeNull();
  });

  it('closes when focus moves out', async () => {
    renderPopover();
    await userEvent.click(trigger());

    await userEvent.tab();
    expect(panel()).not.toBeNull();
    await userEvent.tab();

    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    expect(panel()).toBeNull();
  });

  it('stays open when focus goes nowhere, such as a click on panel text', async () => {
    renderPopover();
    await userEvent.click(trigger());

    fireEvent.focusOut(trigger(), { relatedTarget: null });

    expect(panel()).not.toBeNull();
  });

  it('ignores an Escape that ends an IME composition', async () => {
    renderPopover();
    await userEvent.click(trigger());

    fireEvent.keyDown(trigger(), { key: 'Escape', isComposing: true });

    expect(panel()).not.toBeNull();
  });

  // Other Escape handlers may listen on the window: with the menu open, one Escape must close the
  // menu only.
  describe('Escape and the page beneath', () => {
    const onWindowKey = vi.fn();

    beforeEach(() => {
      onWindowKey.mockReset();
      window.addEventListener('keydown', onWindowKey);
    });

    afterEach(() => window.removeEventListener('keydown', onWindowKey));

    it('keeps Escape from reaching the page while open, and gives it back once closed', async () => {
      renderPopover();
      await userEvent.click(trigger());

      await userEvent.keyboard('{Escape}');
      expect(onWindowKey).not.toHaveBeenCalled();

      await userEvent.keyboard('{Escape}');
      expect(onWindowKey).toHaveBeenCalledTimes(1);
    });

    it('lets go of Escape when unmounted while open', async () => {
      const { unmount } = renderPopover();
      await userEvent.click(trigger());

      unmount();
      fireEvent.keyDown(document.body, { key: 'Escape' });

      expect(onWindowKey).toHaveBeenCalledTimes(1);
    });
  });

  it('gives function content a close that hands focus back to the trigger', async () => {
    render(
      <Popover trigger="Account" panelLabel="Account details">
        {(close) => (
          <button type="button" onClick={close}>
            Done
          </button>
        )}
      </Popover>,
    );
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(panel()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
  });

  it('names a trigger that has no text of its own', () => {
    renderPopover({ trigger: <span aria-hidden="true">•</span>, triggerLabel: 'Open account' });

    expect(screen.getByRole('button', { name: 'Open account' })).toBeInTheDocument();
  });

  // UI-16: closed, the panel `aria-controls` points at is hidden and empty; open, it is a named group.
  it('has no axe violations, closed and open', async () => {
    renderPopover();
    await expectNoAxeViolations();

    await userEvent.click(trigger());

    expect(panel()).not.toBeNull();
    await expectNoAxeViolations();
  });
});
