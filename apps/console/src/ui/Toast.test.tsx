import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { expectNoAxeViolations, resetStore } from '../test-utils';
import { ToastRegion } from './Toast';
import { showToast, type Toast, TOAST_MS, updateToast, useToasts } from './toasts';

type NewToast = Omit<Toast, 'id'>;

/** The store changes outside React, so the region only shows it after `act`. */
const show = (toast: NewToast) => act(() => showToast(toast));
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** A toast has no role or name of its own; `data-toast` marks it, as `aria-live` marks the lists. */
const toastOf = (title: string) => screen.getByText(title).closest<HTMLElement>('[data-toast]')!;
const buttonIn = (title: string, name: string) =>
  within(toastOf(title)).getByRole('button', { name });
const button = (name: string) => screen.getByRole('button', { name });

const withAction = (title: string, onAction: () => void = vi.fn()): NewToast => ({
  title,
  action: { label: 'View incident', onAction },
});

describe('ToastRegion', () => {
  let user: UserEvent;
  let container: HTMLElement;
  const list = (live: 'assertive' | 'polite') =>
    container.querySelector<HTMLElement>(`[aria-live="${live}"]`)!;

  beforeEach(() => {
    resetStore(useToasts);
    user = userEvent.setup();
    // "Outside" comes before the region in the Tab order; "Feed row" stands in for the feed.
    ({ container } = render(
      <>
        <button type="button">Outside</button>
        <ToastRegion fallbackFocus={() => button('Feed row')} />
        <button type="button">Feed row</button>
      </>,
    ));
  });

  describe('live lists', () => {
    it('keeps both lists in the region while there is no toast', () => {
      const region = screen.getByRole('region', { name: 'Notifications' });

      expect(region).toContainElement(list('assertive'));
      expect(region).toContainElement(list('polite'));
      expect(list('assertive')).toBeEmptyDOMElement();
      expect(list('polite')).toBeEmptyDOMElement();
    });

    it('reads urgent toasts out at once and the others politely, urgent ones first', () => {
      show({ title: 'Saved' });
      show({ title: 'Fire alarm', urgent: true });

      expect(list('assertive')).toContainElement(toastOf('Fire alarm'));
      expect(list('polite')).toContainElement(toastOf('Saved'));
      expect(
        list('assertive').compareDocumentPosition(list('polite')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    // UI-16: real timers here — fake ones could hold up axe's own scheduling.
    it('has no axe violations with an urgent and a polite toast', async () => {
      show({ title: 'Fire alarm', urgent: true });
      show(withAction('Door forced open'));

      expect(list('assertive')).toContainElement(toastOf('Fire alarm'));
      await expectNoAxeViolations();
    });
  });

  // Fake timers, so `fireEvent` here: RTL's async wrapper around `user-event` waits on a
  // `setTimeout(0)` that it only advances under Jest's fake timers, so `user.*` hangs under Vitest's.
  describe('dismissal over time', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('lets a normal toast go after TOAST_MS', () => {
      show({ title: 'Saved' });

      advance(TOAST_MS - 1);
      expect(screen.getByText('Saved')).toBeInTheDocument();

      advance(1);
      expect(screen.queryByText('Saved')).toBeNull();
    });

    it('keeps an urgent toast until it is dismissed', () => {
      show({ title: 'Fire alarm', urgent: true });

      advance(10 * TOAST_MS);

      expect(screen.getByText('Fire alarm')).toBeInTheDocument();
    });

    it('waits while pointed at, then counts again from the start', () => {
      show({ title: 'Saved' });

      fireEvent.mouseEnter(toastOf('Saved'));
      advance(TOAST_MS);
      expect(screen.getByText('Saved')).toBeInTheDocument();

      fireEvent.mouseLeave(toastOf('Saved'));
      advance(TOAST_MS - 1);
      expect(screen.getByText('Saved')).toBeInTheDocument();
      advance(1);
      expect(screen.queryByText('Saved')).toBeNull();
    });

    it('waits while focus is inside, then counts again once it leaves', () => {
      show({ title: 'Saved' });

      act(() => buttonIn('Saved', 'Dismiss notification').focus());
      advance(TOAST_MS);
      expect(screen.getByText('Saved')).toBeInTheDocument();

      act(() => button('Outside').focus());
      advance(TOAST_MS);
      expect(screen.queryByText('Saved')).toBeNull();
    });
  });

  describe('buttons and content', () => {
    it('has an icon-only Dismiss button without an action', async () => {
      show({ title: 'Saved' });

      await user.click(buttonIn('Saved', 'Dismiss notification'));

      expect(screen.queryByText('Saved')).toBeNull();
    });

    it('offers the action and Dismiss when it has an action', () => {
      show(withAction('Fire alarm'));

      expect(buttonIn('Fire alarm', 'View incident')).toBeInTheDocument();
      expect(buttonIn('Fire alarm', 'Dismiss')).toBeInTheDocument();
      expect(
        within(toastOf('Fire alarm')).queryByRole('button', { name: 'Dismiss notification' }),
      ).toBeNull();
    });

    it('runs the action once and then goes', async () => {
      const onAction = vi.fn();
      show(withAction('Fire alarm', onAction));

      await user.click(buttonIn('Fire alarm', 'View incident'));

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Fire alarm')).toBeNull();
    });

    describe('with a secondary action (V2-16.5)', () => {
      const withBoth = (
        title: string,
        onAction: () => void = vi.fn(),
        onSecondary: () => void = vi.fn(),
      ): NewToast => ({
        title,
        action: { label: 'Fly to', onAction },
        secondaryAction: { label: 'Open incident', onAction: onSecondary },
      });

      it('offers the action, the secondary action and Dismiss, in that order', () => {
        show(withBoth('Motor over-temperature'));

        const names = within(toastOf('Motor over-temperature'))
          .getAllByRole('button')
          .map((control) => control.textContent);

        expect(names).toEqual(['Fly to', 'Open incident', 'Dismiss']);
      });

      it('runs the secondary action once, not the action, and then goes', async () => {
        const onAction = vi.fn();
        const onSecondary = vi.fn();
        show(withBoth('Motor over-temperature', onAction, onSecondary));

        await user.click(buttonIn('Motor over-temperature', 'Open incident'));

        expect(onSecondary).toHaveBeenCalledTimes(1);
        expect(onAction).not.toHaveBeenCalled();
        expect(screen.queryByText('Motor over-temperature')).toBeNull();
      });

      it('runs the action once, not the secondary action, and then goes', async () => {
        const onAction = vi.fn();
        const onSecondary = vi.fn();
        show(withBoth('Motor over-temperature', onAction, onSecondary));

        await user.click(buttonIn('Motor over-temperature', 'Fly to'));

        expect(onAction).toHaveBeenCalledTimes(1);
        expect(onSecondary).not.toHaveBeenCalled();
        expect(screen.queryByText('Motor over-temperature')).toBeNull();
      });

      it('goes on Dismiss without running either', async () => {
        const onAction = vi.fn();
        const onSecondary = vi.fn();
        show(withBoth('Motor over-temperature', onAction, onSecondary));

        await user.click(buttonIn('Motor over-temperature', 'Dismiss'));

        expect(onAction).not.toHaveBeenCalled();
        expect(onSecondary).not.toHaveBeenCalled();
        expect(screen.queryByText('Motor over-temperature')).toBeNull();
      });

      it('can be used from the keyboard: Tab reaches each button and Enter runs it', async () => {
        const onSecondary = vi.fn();
        show(withBoth('Motor over-temperature', vi.fn(), onSecondary));
        act(() => buttonIn('Motor over-temperature', 'Fly to').focus());

        await user.tab();
        expect(buttonIn('Motor over-temperature', 'Open incident')).toHaveFocus();
        await user.keyboard('{Enter}');

        expect(onSecondary).toHaveBeenCalledTimes(1);
      });

      it('leaves the toast before the secondary action runs', async () => {
        let focusedDuringAction: Element | null = null;
        show(
          withBoth('A', vi.fn(), () => {
            focusedDuringAction = document.activeElement;
          }),
        );
        act(() => button('Outside').focus());
        await user.tab();
        await user.tab();
        expect(buttonIn('A', 'Open incident')).toHaveFocus();

        await user.keyboard('{Enter}');

        expect(focusedDuringAction).toBe(button('Outside'));
      });

      it('hands focus to the secondary action of the next toast, else to its first button', async () => {
        show(withBoth('A'));
        show(withBoth('B'));
        show({ title: 'C' });
        act(() => buttonIn('A', 'Dismiss').focus());
        await user.keyboard('{Enter}');
        expect(buttonIn('B', 'Dismiss')).toHaveFocus();

        // B holds the secondary action's focus; the next toast, C, has no such control.
        act(() => buttonIn('B', 'Open incident').focus());
        await user.keyboard('{Enter}');

        expect(buttonIn('C', 'Dismiss notification')).toHaveFocus();
      });

      it('shows no secondary button without one, and none without an action', () => {
        show(withAction('Fire alarm'));
        show({ title: 'Saved', secondaryAction: { label: 'Open incident', onAction: vi.fn() } });

        expect(
          within(toastOf('Fire alarm'))
            .getAllByRole('button')
            .map((control) => control.textContent),
        ).toEqual(['View incident', 'Dismiss']);
        expect(
          within(toastOf('Saved')).queryByRole('button', { name: 'Open incident' }),
        ).toBeNull();
        expect(buttonIn('Saved', 'Dismiss notification')).toBeInTheDocument();
      });

      it('has no axe violations', async () => {
        show({ ...withBoth('Motor over-temperature'), urgent: true, severity: 'critical' });

        await expectNoAxeViolations();
      });
    });

    it('goes on Dismiss without running the action', async () => {
      const onAction = vi.fn();
      show(withAction('Fire alarm', onAction));

      await user.click(buttonIn('Fire alarm', 'Dismiss'));

      expect(onAction).not.toHaveBeenCalled();
      expect(screen.queryByText('Fire alarm')).toBeNull();
    });

    it('shows the kicker and the detail, tinted by its severity', () => {
      show({
        title: 'Smoke detector',
        kicker: 'New critical · Fire alarm',
        detail: 'Library · INC-000107 · just now',
        severity: 'critical',
      });
      show({ title: 'Saved' });

      expect(screen.getByText('New critical · Fire alarm')).toBeInTheDocument();
      expect(screen.getByText('Library · INC-000107 · just now')).toBeInTheDocument();
      expect(toastOf('Smoke detector')).toHaveAttribute('data-severity', 'critical');
      expect(toastOf('Saved')).not.toHaveAttribute('data-severity');
    });
  });

  // A dismissed toast never leaves focus on the page body (UI-14 Q9).
  describe('focus when a focused toast goes', () => {
    it('moves to the same button in the next toast', async () => {
      show({ title: 'A' });
      show({ title: 'B' });
      act(() => buttonIn('A', 'Dismiss notification').focus());

      await user.keyboard('{Enter}');

      expect(screen.queryByText('A')).toBeNull();
      expect(buttonIn('B', 'Dismiss notification')).toHaveFocus();
    });

    it('moves to the previous toast when there is no next one', async () => {
      show({ title: 'A' });
      show({ title: 'B' });
      act(() => buttonIn('B', 'Dismiss notification').focus());

      await user.keyboard('{Enter}');

      expect(buttonIn('A', 'Dismiss notification')).toHaveFocus();
    });

    it('takes the same control, not the first button, in a toast with an action', async () => {
      show(withAction('A'));
      show(withAction('B'));
      act(() => buttonIn('A', 'Dismiss').focus());

      await user.keyboard('{Enter}');

      expect(buttonIn('B', 'Dismiss')).toHaveFocus();
    });

    it('goes back to where it was before it entered the notifications', async () => {
      show({ title: 'A' });
      act(() => button('Outside').focus());
      await user.tab();

      await user.keyboard('{Enter}');

      expect(button('Outside')).toHaveFocus();
    });

    it('falls back to the given element when it came from nowhere', async () => {
      show({ title: 'A' });
      act(() => buttonIn('A', 'Dismiss notification').focus());

      await user.keyboard('{Enter}');

      expect(button('Feed row')).toHaveFocus();
    });

    it('stays where it is when the toast did not hold it', () => {
      show({ title: 'A' });
      act(() => button('Outside').focus());

      // A click that does not move focus, e.g. Safari's pointer click on a button.
      fireEvent.click(buttonIn('A', 'Dismiss notification'));

      expect(screen.queryByText('A')).toBeNull();
      expect(button('Outside')).toHaveFocus();
    });

    // What the action opens (the incident sheet) records the focused element to return to later.
    it('leaves the toast before the action runs', async () => {
      let focusedDuringAction: Element | null = null;
      show(
        withAction('A', () => {
          focusedDuringAction = document.activeElement;
        }),
      );
      act(() => button('Outside').focus());
      await user.tab();
      expect(buttonIn('A', 'View incident')).toHaveFocus();

      await user.keyboard('{Enter}');

      expect(focusedDuringAction).toBe(button('Outside'));
    });
  });

  describe('a toast whose words change', () => {
    const urgentToast: NewToast = {
      key: 'incident-1',
      title: 'Motor over-temperature',
      kicker: 'Critical · raised by telemetry rule',
      detail: 'CT-01 · Data Center · roof',
      severity: 'critical',
      urgent: true,
      action: { label: 'View incident', onAction: () => {} },
    };
    const READING = 'CT-01 · Data Center · roof · 92 °C for 60 s, limit 85 °C';

    it('is the same element with the new words, in the assertive list', () => {
      show(urgentToast);
      const before = toastOf('Motor over-temperature');

      act(() => void updateToast('incident-1', { detail: READING }));

      expect(toastOf('Motor over-temperature')).toBe(before);
      expect(within(list('assertive')).getByText(READING)).toBeInTheDocument();
      expect(screen.queryByText('CT-01 · Data Center · roof')).toBeNull();
    });

    it('keeps the focus that is on its action', () => {
      show(urgentToast);
      act(() => buttonIn('Motor over-temperature', 'View incident').focus());

      act(() => void updateToast('incident-1', { detail: READING }));

      expect(buttonIn('Motor over-temperature', 'View incident')).toHaveFocus();
    });

    it('can still be dismissed afterwards', async () => {
      show(urgentToast);
      act(() => void updateToast('incident-1', { detail: READING }));

      await user.click(buttonIn('Motor over-temperature', 'Dismiss'));

      expect(screen.queryByText('Motor over-temperature')).toBeNull();
    });

    it('does not bring back a toast that was dismissed', async () => {
      show(urgentToast);
      await user.click(buttonIn('Motor over-temperature', 'Dismiss'));

      act(() => void updateToast('incident-1', { detail: READING }));

      expect(screen.queryByText('Motor over-temperature')).toBeNull();
      expect(screen.queryByText(READING)).toBeNull();
    });
  });
});
