import { type FocusEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import styles from './Popover.module.css';

/**
 * A button that shows and hides a panel under it (WAI-ARIA APG disclosure pattern), for content
 * that is mostly information with a few actions, such as the user menu. It is non-modal: no focus
 * trap, the page stays usable, and focus stays on the trigger when it opens (Tab moves into the
 * panel next). Not an ARIA `menu`: a menu may hold menu items only.
 *
 * It closes on Escape (focus back to the trigger), on a pointer down outside it, and when focus
 * moves to something outside it. While open it owns Escape: the key never also reaches the
 * window-level listeners below it, such as the incident sheet's `useCloseOnEscape`.
 *
 * The trigger's look (border, fill when open) is the popover's; its layout and size come from
 * `triggerClassName`. Give the trigger visible text; `triggerLabel` is for a trigger without any.
 */
export function Popover({
  trigger,
  triggerLabel,
  triggerClassName,
  panelLabel,
  className,
  panelClassName,
  children,
}: {
  trigger: ReactNode;
  triggerLabel?: string;
  triggerClassName?: string;
  panelLabel: string;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const panelId = `${useId()}-panel`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

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
      <div
        id={panelId}
        role="group"
        aria-label={panelLabel}
        hidden={!open}
        className={panelClassName ? `${styles.panel} ${panelClassName}` : styles.panel}
      >
        {open && children}
      </div>
    </div>
  );
}
