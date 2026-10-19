import type { TelemetryPoint } from '@occ/contracts';
import { type KeyboardEvent, useRef, useState } from 'react';
import { hasChildren, partText, type PartRow } from '../lib/modelParts';
import { nextRowIndex } from '../lib/rowNavigation';
import type { AssetTelemetryState } from '../lib/telemetryState';
import { Icon } from '../ui/Icon';
import { Box, ChevronDown, CircleDot } from '../ui/icons';
import { SheetSection } from '../ui/SheetSection';
import { Skeleton } from '../ui/Skeleton';
import styles from './AssetParts.module.css';

/**
 * The parts of a modelled asset with the reading each shows (frames 03, 05, 08): a tree of one or
 * two levels, every part open. The rows are the model's own (`partRows`, V2-14.10), the caller builds them. A row is not selectable yet: selecting a part and the callout are
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
  parts: readonly PartRow[];
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
        {parts.map((row, index) => {
          const key = row.bind;
          const point = key === null ? undefined : points.find((p) => p.key === key);
          // The freshest copy wins, as the readings rows: frames are laid over the headline.
          const value = key === null ? undefined : (entry?.values[key] ?? entry?.headline[key]);
          const parent = hasChildren(row, parts);
          return (
            <li
              key={row.name}
              ref={(element) => {
                rows.current[index] = element;
              }}
              role="treeitem"
              aria-level={row.parent === null ? 1 : 2}
              aria-expanded={parent ? true : undefined}
              tabIndex={index === active ? 0 : -1}
              className={styles.row}
              data-level={row.parent === null ? 1 : 2}
              data-stale={stale && row.bind !== null ? 'true' : undefined}
              onFocus={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <Icon
                glyph={parent ? ChevronDown : row.bind === null ? Box : CircleDot}
                size={16}
                className={styles.glyph}
              />
              <span className={styles.label}>{row.label}</span>
              <span className={styles.value}>{partText(row, point, value, stale)}</span>
            </li>
          );
        })}
      </ul>
    </SheetSection>
  );
}

/**
 * The Parts section while the model's node tree is on its way (the first asset of a class, until its file is
 * read; the next ones find it cached). The same title and rows' height as `AssetParts`, so the sheet does not
 * jump when the rows arrive. Like the inspector's own skeleton: the blocks are hidden from assistive tech and the
 * region says once that it is loading.
 */
export function AssetPartsSkeleton() {
  return (
    <SheetSection title="Parts">
      <div className={styles.skeletonRows} aria-busy="true">
        <span className={styles.hidden}>Loading parts…</span>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className={styles.skeletonRow} />
        ))}
      </div>
    </SheetSection>
  );
}
