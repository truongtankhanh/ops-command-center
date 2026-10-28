import {
  type FocusEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Panel } from './Panel';
import styles from './Popover.module.css';

/**
 * A button that shows and hides a panel under it (WAI-ARIA APG disclosure pattern), for content
 * that is mostly information with a few actions, such as the user menu. It is non-modal: no focus
 * trap, the page stays usable, and focus stays on the trigger when it opens (Tab moves into the
 * panel next). Not an ARIA `menu`: a menu may hold menu items only.
 *
 * It closes on Escape (focus back to the trigger), on a pointer down outside it, and when focus
 * moves to something outside it. While open it owns Escape: the key is stopped in the capture
 * phase, so no other Escape handler on the page also acts on it.
 *
 * The trigger's look (border, fill when open) is the popover's; its layout and size come from
 * `triggerClassName`. Give the trigger visible text; `triggerLabel` is for a trigger without any.
 * The panel's surface is the floating `Panel`; the popover only places it: under the trigger by default,
 * or over it with `placement="above"` for a trigger at the foot of the screen (the status bar's Settings,
 * V3-06.3), where a panel below would leave the viewport. Only `above` is written as an attribute.
 *
 * `triggerRef` gives the trigger button to a consumer that must put focus back on it from outside the panel, such as
 * a chip that clears what the panel set (the feed's category filter, V3-07.3).
 *
 * `children` may be a function that gets `close`: an item that opens something else (a dialog)
 * calls it first. It closes the panel and puts focus back on the trigger, so what opens next
 * records the trigger, which stays in the page, as the place to return focus to.
 */
export function Popover({
  trigger,
  triggerLabel,
  triggerClassName,
  triggerRef,
  panelLabel,
  placement = 'below',
  className,
  panelClassName,
  children,
}: {
  trigger: ReactNode;
  triggerLabel?: string;
  triggerClassName?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  panelLabel: string;
  placement?: 'below' | 'above';
  className?: string;
  panelClassName?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const id = useId();
  const panelId = `${id}-panel`;
  const triggerId = `${id}-trigger`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Finds the trigger by id, not through a ref: `close` is handed to function content during
  // render, and a function that reads a ref must not be (react-hooks/refs).
  const close = useCallback(() => {
    setOpen(false);
    document.getElementById(triggerId)?.focus();
  }, [triggerId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture phase on the document: runs before the window-level Escape listeners, and also when
    // focus is on the page body (Safari does not focus a button on click).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  // Only a move to a known element outside closes it (e.g. Tab past the last item). A null target
  // is a click on non-focusable panel text or a switch to another window; outside clicks are
  // handled by the pointer listener above.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next && !event.currentTarget.contains(next)) setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={className ? `${styles.root} ${className}` : styles.root}
      onBlur={onBlur}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={triggerClassName ? `${styles.trigger} ${triggerClassName}` : styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={triggerLabel}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {/*
       * The panel is always rendered, so `aria-controls` points at a real element; its content only
       * while open, so closed content is not in the DOM at all (e.g. no second copy of the user's
       * name for text queries to trip over).
       */}
      <Panel
        variant="floating"
        id={panelId}
        role="group"
        aria-label={panelLabel}
        data-placement={placement === 'above' ? 'above' : undefined}
        hidden={!open}
        className={panelClassName ? `${styles.panel} ${panelClassName}` : styles.panel}
      >
        {open && (typeof children === 'function' ? children(close) : children)}
      </Panel>
    </div>
  );
}
