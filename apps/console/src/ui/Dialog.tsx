import {
  Children,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';
import { focusLost } from './focus';

const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

/**
 * A modal dialog (WAI-ARIA APG dialog pattern), such as a confirmation before an action that cannot
 * be undone. Unlike `Sheet` and `Popover` it blocks the page: the caller mounts it while it is open
 * and unmounts it to close it.
 *
 * - Rendered through a portal on `body`, over a `--scrim` at `--z-dialog`, so no ancestor's
 *   `overflow` or stacking context clips it. The session-expired banner (`--z-session`) stays above.
 * - Focus moves to the first focusable element in `actions` — put the safe choice first, so Enter
 *   right after opening never runs the action — or, with none there, to the first in the body.
 *   Tab and Shift+Tab cycle inside the dialog.
 * - `size="wide"` gives room to content such as the camera viewer (UI-13); the default fits a
 *   confirmation.
 * - The body is the dialog's description, read out when it opens. For a long body (a list), pass
 *   `describedBy` with the id of the short part that describes it instead.
 * - Escape and a click on the scrim call `onCancel`. Every key pressed inside the dialog is stopped
 *   there: React stops the synthetic bubble (the `Sheet`'s Escape behind it) and the native one at
 *   the portal's container (the page's single-key shortcuts on `window`).
 * - On close, focus goes back to the element focused when it opened, but only if focus was lost
 *   with the dialog: an action that moved focus on purpose (e.g. into a field) keeps it there.
 *
 * The page behind is not made `inert`: the session-expired banner lives in the same React root and
 * must stay reachable. `aria-modal` tells assistive tech the rest of the page is out of reach.
 */
export function Dialog({
  title,
  onCancel,
  actions,
  size = 'default',
  describedBy,
  children,
}: {
  title: string;
  onCancel: () => void;
  actions: ReactNode;
  size?: 'default' | 'wide';
  /** The id of the element that describes the dialog, in place of the whole body. */
  describedBy?: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  const bodyId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  // Not `children` itself: a body built from conditions (`[false, null]`) is truthy but empty.
  const hasBody = Children.toArray(children).length > 0;

  // Layout effect: focus is inside before the browser paints the dialog.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const active = document.activeElement;
    const returnTo = active instanceof HTMLElement && active !== document.body ? active : null;
    const first =
      (actionsRef.current && focusables(actionsRef.current)[0]) ?? focusables(dialog)[0];
    (first ?? dialog).focus({ preventScroll: true });
    return () => {
      // Waits for the dialog to leave the DOM, so `focusLost` sees where focus really ended up.
      queueMicrotask(() => {
        if (returnTo?.isConnected && focusLost()) returnTo.focus({ preventScroll: true });
      });
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(event.currentTarget);
    const first = items[0];
    const last = items.at(-1);
    const active = document.activeElement;
    if (!first || !last) {
      event.preventDefault();
    } else if (event.shiftKey && (active === first || active === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onCancel();
  };

  return createPortal(
    <div className={styles.scrim} onClick={onScrimClick}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy ?? (hasBody ? bodyId : undefined)}
        tabIndex={-1}
        className={styles.dialog}
        data-size={size === 'wide' ? 'wide' : undefined}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {hasBody && (
          <div id={bodyId} className={styles.body}>
            {children}
          </div>
        )}
        <div ref={actionsRef} className={styles.actions}>
          {actions}
        </div>
      </div>
    </div>,
    document.body,
  );
}
