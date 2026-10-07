import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import styles from './Sheet.module.css';

/**
 * What the sheets under one `SheetHost` share. Held in a ref and never rendered: it only carries
 * focus bookkeeping across the unmount / mount of a content switch.
 */
interface SheetSession {
  /** The element focused when the first sheet opened; focus goes back to it on the last close. */
  opener: HTMLElement | null;
  /** Sheets mounted right now. */
  mounted: number;
  /** A sheet unmounted in the current commit; a sheet mounting now is a switch, not an open. */
  closing: boolean;
}

const newSession = (): SheetSession => ({ opener: null, mounted: 0, closing: false });

const SheetHostContext = createContext<RefObject<SheetSession> | null>(null);

/**
 * Lets the sheets rendered under it act as one: when the content changes (another incident, or the
 * report form turning into the new incident's detail), the next sheet takes over the opener instead
 * of recording a new one, and focus stays where the operator is.
 */
export function SheetHost({ children }: { children: ReactNode }) {
  // A ref, so the context value never changes and no consumer re-renders for it.
  const session = useRef(newSession());
  return <SheetHostContext.Provider value={session}>{children}</SheetHostContext.Provider>;
}

/** Focus went nowhere: the focused element was removed, or nothing had focus. */
function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * The panel over the right of the stage (frame 02) that holds the incident detail or the report
 * form. It is **non-modal**: no focus trap, no backdrop — the feed and the map stay usable beside it.
 *
 * - Focus moves to the sheet itself when it opens (`tabIndex={-1}`, named by `label`), so the
 *   name is announced and the target exists before any content has loaded.
 * - Under a `SheetHost`, a sheet that replaces another one in the same commit is a switch: it keeps
 *   the first sheet's opener and takes focus only if focus was lost with the old content.
 * - On the last close, focus goes back to the opener, but only if focus was lost (it was inside the
 *   sheet): a close caused by a click elsewhere, e.g. on the map, leaves focus there. The return
 *   waits one microtask, so a sheet mounting in the same commit can cancel it.
 * - Escape is handled here, on the sheet, not on `window`: it reaches the sheet only while focus is
 *   inside it. It is ignored during IME composition (e.g. Vietnamese input) and when something
 *   inside already handled it. With `keepOpen` (the content holds a draft) Escape never closes:
 *   `onEscapeKept` is called and `keptMessage` is announced instead; Close / Cancel still discard.
 *
 * Without a `SheetHost` every sheet is on its own: it records its opener on mount and returns
 * focus on unmount.
 */
export function Sheet({
  label,
  id,
  onClose,
  keepOpen = false,
  keptMessage,
  onEscapeKept,
  children,
}: {
  label: string;
  id?: string;
  onClose: () => void;
  keepOpen?: boolean;
  keptMessage?: string;
  onEscapeKept?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const hostSession = useContext(SheetHostContext);
  const ownSession = useRef(newSession());
  const sessionRef = hostSession ?? ownSession;

  // Bumped by every ignored Escape: a new keyed node in the live region is announced again, even
  // when the text is the same as last time.
  const [keptCount, setKeptCount] = useState(0);
  const [wasKeepOpen, setWasKeepOpen] = useState(keepOpen);
  if (keepOpen !== wasKeepOpen) {
    setWasKeepOpen(keepOpen);
    // A cleared draft forgets the announcement, so writing a new one does not repeat it.
    if (!keepOpen) setKeptCount(0);
  }

  // Layout effect: focus moves before the browser paints the opened sheet.
  useLayoutEffect(() => {
    const sheet = ref.current;
    const session = sessionRef.current;
    if (!sheet) return;
    if (session.closing) {
      session.closing = false;
      if (focusLost()) sheet.focus({ preventScroll: true });
    } else {
      const active = document.activeElement;
      session.opener = active instanceof HTMLElement && active !== document.body ? active : null;
      sheet.focus({ preventScroll: true });
    }
    session.mounted += 1;

    return () => {
      session.mounted -= 1;
      session.closing = true;
      queueMicrotask(() => {
        session.closing = false;
        if (session.mounted > 0) return;
        const { opener } = session;
        session.opener = null;
        if (opener?.isConnected && focusLost()) opener.focus({ preventScroll: true });
      });
    };
  }, [sessionRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    if (!keepOpen) {
      onClose();
      return;
    }
    onEscapeKept?.();
    setKeptCount((count) => count + 1);
  };

  return (
    <aside
      ref={ref}
      id={id}
      className={styles.sheet}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {children}
      <div role="status" className={styles.status}>
        {keptCount > 0 && keptMessage && <span key={keptCount}>{keptMessage}</span>}
      </div>
    </aside>
  );
}
