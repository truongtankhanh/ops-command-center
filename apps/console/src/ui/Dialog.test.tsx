import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type KeyboardEventHandler, useRef, useState } from 'react';
import { Dialog } from './Dialog';

/** Opens a dialog from a button on a small page, the way the incident sheet opens its confirmation. */
function Harness({
  actions = 'three',
  body = true,
  bodyLink = false,
  size,
  removeOpener = false,
  onCancel,
  onAncestorKey,
}: {
  actions?: 'three' | 'none';
  body?: boolean;
  /** A focusable element in the body, as the camera viewer has (UI-13). */
  bodyLink?: boolean;
  size?: 'default' | 'wide';
  removeOpener?: boolean;
  onCancel?: () => void;
  onAncestorKey?: KeyboardEventHandler;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  return (
    <div onKeyDown={onAncestorKey}>
      {!(removeOpener && open) && <button onClick={() => setOpen(true)}>Open</button>}
      <input ref={field} aria-label="Outside field" />
      {open && (
        <Dialog
          title="Delete the record?"
          size={size}
          onCancel={() => {
            onCancel?.();
            setOpen(false);
          }}
          actions={
            actions === 'none' ? (
              <span>No choice</span>
            ) : (
              <>
                <button onClick={() => setOpen(false)}>Keep</button>
                <button
                  onClick={() => {
                    field.current?.focus();
                    setOpen(false);
                  }}
                >
                  Edit first
                </button>
                <button onClick={() => setOpen(false)}>Delete</button>
              </>
            )
          }
        >
          {/* Without a body or a link the children are `[false, false]`: still no body. */}
          {body && <p>It cannot be undone.</p>}
          {bodyLink && <a href="#help">Read the policy</a>}
        </Dialog>
      )}
    </div>
  );
}

const dialog = () => screen.getByRole('dialog', { name: 'Delete the record?' });
const queryDialog = () => screen.queryByRole('dialog', { name: 'Delete the record?' });
const button = (name: string) => screen.getByRole('button', { name });
/** Lets the microtask that returns focus after a close run, before asserting it did not. */
const flush = () => act(async () => {});

async function open(props: Parameters<typeof Harness>[0] = {}) {
  const view = render(<Harness {...props} />);
  await userEvent.click(button('Open'));
  return view;
}

describe('Dialog', () => {
  describe('opening', () => {
    it('opens as a modal named by its title and described by its body', async () => {
      await open();

      expect(dialog()).toHaveAttribute('aria-modal', 'true');
      expect(dialog()).toHaveAccessibleDescription('It cannot be undone.');
    });

    it('has no description without a body', async () => {
      await open({ body: false });

      expect(dialog()).not.toHaveAttribute('aria-describedby');
    });

    it('renders outside the page that opened it', async () => {
      const { container } = await open();

      // A portal on body: no ancestor's overflow or stacking context can clip it.
      expect(container).not.toContainElement(dialog());
      expect(document.body).toContainElement(dialog());
    });

    it('moves focus to the first action', async () => {
      await open();

      expect(button('Keep')).toHaveFocus();
    });

    it('focuses the dialog itself when no action can take focus', async () => {
      await open({ actions: 'none' });

      expect(dialog()).toHaveFocus();
    });

    it('moves focus to the first action even when the body holds a link', async () => {
      await open({ bodyLink: true });

      expect(button('Keep')).toHaveFocus();
    });

    it('falls back to the first focusable element in the body when no action can take focus', async () => {
      await open({ actions: 'none', bodyLink: true });

      expect(screen.getByRole('link', { name: 'Read the policy' })).toHaveFocus();
    });

    it('is wide only when asked', async () => {
      const { unmount } = await open();
      expect(dialog()).not.toHaveAttribute('data-size');
      unmount();

      await open({ size: 'wide' });
      expect(dialog()).toHaveAttribute('data-size', 'wide');
    });
  });

  describe('keyboard', () => {
    it('wraps Tab from the last action to the first', async () => {
      await open();

      await userEvent.tab();
      await userEvent.tab();
      expect(button('Delete')).toHaveFocus();

      await userEvent.tab();
      expect(button('Keep')).toHaveFocus();
    });

    it('wraps Shift+Tab from the first action to the last', async () => {
      await open();

      await userEvent.tab({ shift: true });

      expect(button('Delete')).toHaveFocus();
    });

    it('sends Shift+Tab from the dialog itself to the last action', async () => {
      await open();
      act(() => dialog().focus());

      await userEvent.tab({ shift: true });

      expect(button('Delete')).toHaveFocus();
    });

    it('keeps focus on the dialog when Tab has nowhere to go', async () => {
      await open({ actions: 'none' });

      await userEvent.tab();
      expect(dialog()).toHaveFocus();

      await userEvent.tab({ shift: true });
      expect(dialog()).toHaveFocus();
    });

    it('cancels on Escape', async () => {
      const onCancel = vi.fn();
      await open({ onCancel });

      await userEvent.keyboard('{Escape}');

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(queryDialog()).toBeNull();
    });

    it('ignores Escape that ends an IME composition', async () => {
      const onCancel = vi.fn();
      await open({ onCancel });

      fireEvent.keyDown(button('Keep'), { key: 'Escape', isComposing: true });

      expect(onCancel).not.toHaveBeenCalled();
      expect(dialog()).toBeInTheDocument();
    });

    // The page behind a modal must not act on its keys: the sheet's Escape (a React ancestor) and
    // the single-key shortcuts (`window` listeners).
    it('keeps every key to itself', async () => {
      const onWindowKey = vi.fn();
      const onAncestorKey = vi.fn();
      window.addEventListener('keydown', onWindowKey);
      try {
        await open({ onAncestorKey });

        await userEvent.keyboard('a');
        await userEvent.keyboard('{Escape}');
        expect(onWindowKey).not.toHaveBeenCalled();
        expect(onAncestorKey).not.toHaveBeenCalled();

        // Outside a dialog the same key reaches both, so the spies above could have seen it.
        await userEvent.type(screen.getByLabelText('Outside field'), 'a');
        expect(onWindowKey).toHaveBeenCalledTimes(1);
        expect(onAncestorKey).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener('keydown', onWindowKey);
      }
    });
  });

  describe('pointer', () => {
    it('cancels on a click on the backdrop', async () => {
      const onCancel = vi.fn();
      await open({ onCancel });

      // The backdrop is decorative and has no role: it is the dialog's parent.
      await userEvent.click(dialog().parentElement!);

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(queryDialog()).toBeNull();
    });

    it('stays open on a click inside it', async () => {
      const onCancel = vi.fn();
      await open({ onCancel });

      await userEvent.click(screen.getByText('It cannot be undone.'));

      expect(onCancel).not.toHaveBeenCalled();
      expect(dialog()).toBeInTheDocument();
    });
  });

  describe('focus return', () => {
    it('returns focus to the opener after Escape', async () => {
      await open();

      await userEvent.keyboard('{Escape}');

      await waitFor(() => expect(button('Open')).toHaveFocus());
    });

    it('returns focus to the opener after an action closes it', async () => {
      await open();

      await userEvent.click(button('Keep'));

      await waitFor(() => expect(button('Open')).toHaveFocus());
    });

    it('leaves focus where an action moved it', async () => {
      await open();

      await userEvent.click(button('Edit first'));
      await flush();

      expect(screen.getByLabelText('Outside field')).toHaveFocus();
    });

    it('does not return focus to an opener that is gone', async () => {
      await open({ removeOpener: true });
      expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();

      await userEvent.keyboard('{Escape}');
      await flush();

      expect(queryDialog()).toBeNull();
      expect(document.body).toHaveFocus();
    });
  });
});
