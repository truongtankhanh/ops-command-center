import type { ComponentProps } from 'react';
import type { ZoneGroup } from '../../lib/incidents/groupByZone';
import { severityLabel } from '../../lib/incidents/incidents';
import { Icon } from '../../ui/Icon';
import { ChevronRight, severityIcon } from '../../ui/icons';
import styles from './ZoneGroupRow.module.css';

/**
 * One zone in the grouped feed (V3-21.4, frame 16): the zone's name, the number of incidents it holds, its worst severity as
 * glyph and word, and how many are still open. A button with `aria-expanded`: Enter and Space (the button's own activation)
 * open or close the group, whose incidents then follow it in the same list. It is a view of the same incidents; it has no status
 * of its own and no action on the group (real grouping and bulk acknowledge are V4).
 *
 * The accessible name is one string that starts with the visible zone name (WCAG 2.5.3): the visible parts are separate boxes,
 * which a name computed from them would read run together. The severity is the tile's glyph and the word in the second line,
 * never colour alone. The tile and the chevron are decorative.
 *
 * The feed owns keyboard navigation across rows: it passes the roving `tabIndex`, a `ref` to move focus with the arrow keys and
 * `onFocus` to remember which row holds the tab stop, exactly as for `IncidentRow`. The console only: the wall never lists
 * groups.
 */
export function ZoneGroupRow({
  group,
  expanded,
  onToggle,
  ref,
  tabIndex,
  onFocus,
}: {
  group: ZoneGroup;
  expanded: boolean;
  onToggle: () => void;
} & Pick<ComponentProps<'button'>, 'ref' | 'tabIndex' | 'onFocus'>) {
  const { name, count, open, worst } = group;
  const worstWord = severityLabel(worst);
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      onFocus={onFocus}
      className={styles.row}
      data-severity={worst}
      aria-expanded={expanded}
      aria-label={`${name}, ${count} ${count === 1 ? 'incident' : 'incidents'}, worst ${worstWord}, ${open} open`}
      onClick={onToggle}
    >
      <span className={styles.tile} aria-hidden="true">
        <Icon glyph={severityIcon(worst)} size={20} />
      </span>
      <span className={styles.name} title={name}>
        {name}
      </span>
      <span className={styles.count} aria-hidden="true">
        {count}
      </span>
      <span className={styles.meta} aria-hidden="true">{`Worst: ${worstWord} · ${open} open`}</span>
      <Icon glyph={ChevronRight} size={16} className={styles.chevron} />
    </button>
  );
}
