import type { TelemetryPoint } from '@occ/contracts';
import { type KeyboardEvent, useRef, useState } from 'react';
import { hasChildren, partText, type PartSpec } from '../lib/assetParts';
import { nextRowIndex } from '../lib/rowNavigation';
import type { AssetTelemetryState } from '../lib/telemetryState';
import { Icon } from '../ui/Icon';
import { Box, ChevronDown, CircleDot } from '../ui/icons';
import { SheetSection } from '../ui/SheetSection';
import styles from './AssetParts.module.css';

/**
 * The parts of a modelled asset with the reading each shows (frames 03, 05, 08): a tree of one or
 * two levels, every part open. A row is not selectable yet: selecting a part and the callout are
 * V2-15, which turns the rows into buttons. Until then a row is a `treeitem` that is only read, so
 * there is no control that does nothing.
 *
 * It is the ARIA tree pattern's reading half: one tab stop (a roving `tabIndex`), the arrow keys
 * and Home / End move between rows (`nextRowIndex`, as the feeds). Nothing collapses, so Left and
 * Right have no meaning here.
 *
 * It reads values from the `entry` the caller already holds, with no subscription of its own, so
 * the inspector still re-renders for its own asset's readings only. `stale` is the caller's single
 * fact (as for `AssetReadings`).
 */
export function AssetParts({
  assetCode,
  parts,
  points,
  entry,
  stale,
}: {
  assetCode: string;
  parts: readonly PartSpec[];
  points: readonly TelemetryPoint[];
  /** `undefined` while nothing was received for the asset. */
  entry: AssetTelemetryState | undefined;
  stale: boolean;
}) {
  // The row that holds the tab stop; arrow keys move it, focusing a row by other means sets it.
  const [active, setActive] = useState(0);
  const rows = useRef<(HTMLLIElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    const next = nextRowIndex(event.key, index, parts.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    rows.current[next]?.focus();
  };

  return (
    <SheetSection title="Parts">
      <ul role="tree" aria-label={`Parts of ${assetCode}`} className={styles.tree}>
        {parts.map((spec, index) => {
          const key = spec.bind;
          const point = key === null ? undefined : points.find((p) => p.key === key);
          // The freshest copy wins, as the readings rows: frames are laid over the headline.
          const value = key === null ? undefined : (entry?.values[key] ?? entry?.headline[key]);
          const parent = hasChildren(spec, parts);
          return (
            <li
              key={spec.role}
              ref={(element) => {
                rows.current[index] = element;
              }}
              role="treeitem"
              aria-level={spec.parent === null ? 1 : 2}
              aria-expanded={parent ? true : undefined}
              tabIndex={index === active ? 0 : -1}
              className={styles.row}
              data-level={spec.parent === null ? 1 : 2}
              data-stale={stale && spec.bind !== null ? 'true' : undefined}
              onFocus={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <Icon
                glyph={parent ? ChevronDown : spec.bind === null ? Box : CircleDot}
                size={16}
                className={styles.glyph}
              />
              <span className={styles.label}>{spec.label}</span>
              <span className={styles.value}>{partText(spec, point, value, stale)}</span>
            </li>
          );
        })}
      </ul>
    </SheetSection>
  );
}
