import { type KeyboardEvent, useCallback, useRef } from 'react';
import type { FeedView } from '../../lib/incidents/feedView';
import { INCIDENT_TABLE_ID } from '../../lib/incidents/useIncidentTableShown';
import { useDisplayMode } from '../../lib/shell/useDisplayMode';
import { useShortcut } from '../../lib/shell/useShortcut';
import { useConsole } from '../../store';
import { Icon } from '../../ui/Icon';
import { feedViewIcon } from '../../ui/icons';
import { nextTabIndex } from '../../ui/tabNavigation';
import styles from './FeedViewSwitch.module.css';

/**
 * The group's element id, for V3-24.5's Esc to hand focus back to the switch. The group itself is not focusable: focus
 * its checked radio (`#feed-view-switch [role="radio"][aria-checked="true"]`). The switch is a single instance, as
 * `VIEW_SWITCH_3D_ID` is.
 */
export const FEED_VIEW_SWITCH_ID = 'feed-view-switch';

const OPTIONS: readonly { view: FeedView; label: string }[] = [
  { view: 'list', label: 'List' },
  { view: 'table', label: 'Table' },
];

/** ↑ and ↓ move as ← and → do (APG radio group); `nextTabIndex` stays horizontal for `Tabs`. */
const VERTICAL_AS_HORIZONTAL: Readonly<Record<string, string>> = {
  ArrowUp: 'ArrowLeft',
  ArrowDown: 'ArrowRight',
};

/**
 * The incident sidebar's List | Table switch (V3-24.3, frame 19): the list stays the default, the table is for a
 * supervisor or a flood. A radio group (WAI-ARIA APG), as the task asks and as `RangeSwitch` (V3-23.3) is: one Tab stop on
 * the checked option, ← / → and ↑ / ↓ move and check at once (wrapping), Home and End jump to the ends, Space and a click
 * check. Frame 19 draws `role="group"` toggles; a radio group says "one of two" and is what the store holds.
 *
 * Glyph-only, as frame 19 draws it (two words do not fit beside "Incidents" and "Assets" in a 320 px column): each option
 * is named by its word in a visually hidden text node, so the name is real text, and carries a `title` for the mouse.
 *
 * The second copy of `RangeSwitch`'s keys and look; not `ui/SegmentedControl`, which is native radios under a visible
 * legend. Extract a `ui/RadioSwitch` when a third appears.
 *
 * Rendered only where it can act: not on a phone width, where the list is the only view (`effectiveFeedView`), and not
 * while the Assets panel is shown, since it switches the incident view. The same for every role: a view changes nothing
 * on the site. V3-24.4 mounts it at the right end of `SidePanel`'s tab row, outside the tab list.
 *
 * `T` toggles the view (V3-24.5, brief § Table mode). A character key, so `useShortcut` turns it off with the account
 * menu's switch (WCAG 2.1.4) and ignores it in text fields; the help lists it under "Anywhere". It is enabled exactly where
 * the switch is drawn (the Incidents panel, not a phone width) and never on the wall, which mounts no side panel anyway:
 * elsewhere it would change the stored choice with nothing to see. Glyph-only, so the key is announced through
 * `aria-keyshortcuts` on the group, with no visible hint, as the 3D drag tool's `P` is. When `T` removes the table while
 * focus is in it, focus moves to the radio that is now checked, so it never drops to the page.
 */
export function FeedViewSwitch() {
  const feedView = useConsole((s) => s.feedView);
  const setFeedView = useConsole((s) => s.setFeedView);
  const sidePanel = useConsole((s) => s.sidePanel);
  const onWall = useConsole((s) => s.wall !== null);
  const keysOn = useConsole((s) => s.keyboardShortcuts);
  const mode = useDisplayMode();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Reads the store at the moment of the press, so its identity never changes and `useShortcut` keeps one listener.
  const toggleView = useCallback(() => {
    const { feedView: current, setFeedView: setView } = useConsole.getState();
    const next: FeedView = current === 'table' ? 'list' : 'table';
    const table = document.getElementById(INCIDENT_TABLE_ID);
    const focusInTable = table !== null && table.contains(document.activeElement);
    setView(next);
    // The radio element stays the same across the re-render, so it can take focus before the table unmounts.
    if (focusInTable) refs.current[OPTIONS.findIndex((option) => option.view === next)]?.focus();
  }, []);
  useShortcut('t', toggleView, sidePanel === 'incidents' && mode !== 'phone' && !onWall);

  if (mode === 'phone' || sidePanel !== 'incidents') return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const key = VERTICAL_AS_HORIZONTAL[event.key] ?? event.key;
    const next = nextTabIndex(key, current, OPTIONS.length);
    const target = next === null ? undefined : OPTIONS[next];
    if (next === null || !target) return;
    event.preventDefault();
    setFeedView(target.view);
    refs.current[next]?.focus();
  };

  return (
    <div
      id={FEED_VIEW_SWITCH_ID}
      role="radiogroup"
      aria-label="Incident view"
      aria-keyshortcuts={keysOn ? 'T' : undefined}
      className={styles.switch}
      onKeyDown={onKeyDown}
    >
      {OPTIONS.map((option, index) => {
        const checked = option.view === feedView;
        return (
          <button
            key={option.view}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            title={option.label}
            className={styles.option}
            onClick={() => setFeedView(option.view)}
          >
            <Icon glyph={feedViewIcon(option.view)} size={16} />
            <span className={styles.hidden}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
