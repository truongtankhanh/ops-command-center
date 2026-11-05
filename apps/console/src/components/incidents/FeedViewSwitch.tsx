import { type KeyboardEvent, useRef } from 'react';
import type { FeedView } from '../../lib/incidents/feedView';
import { useDisplayMode } from '../../lib/shell/useDisplayMode';
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
 */
export function FeedViewSwitch() {
  const feedView = useConsole((s) => s.feedView);
  const setFeedView = useConsole((s) => s.setFeedView);
  const sidePanel = useConsole((s) => s.sidePanel);
  const mode = useDisplayMode();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

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
