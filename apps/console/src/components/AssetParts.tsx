import type { TelemetryPoint } from '@occ/contracts';
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { hasChildren, partText, type PartRow } from '../lib/modelParts';
import { nextRowIndex } from '../lib/incidents/rowNavigation';
import type { AssetTelemetryState } from '../lib/telemetry/telemetryState';
import { focusSelection } from '../lib/twinFocus';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { Box, ChevronDown, CircleDot } from '../ui/icons';
import { SheetSection } from '../ui/SheetSection';
import { Skeleton } from '../ui/Skeleton';
import styles from './AssetParts.module.css';

/** What this list wrote to the store's hover, so it takes back only that (V2-15.11). */
interface HoverWrite {
  assetCode: string;
  part: string;
}

/**
 * Takes back the hover `wrote` holds, and only what the store still holds: a hover that the map, the Assets tab or
 * the scene wrote in the meantime is theirs and stays. A function of its own, called from the row's leave and from the
 * unmount cleanup, because React fires no `mouseleave` for a row that unmounts under the pointer (the inspector
 * closes on Escape).
 */
function takeBackHover(wrote: RefObject<HoverWrite | null>): void {
  const mine = wrote.current;
  if (mine === null) return;
  wrote.current = null;
  const store = useConsole.getState();
  if (store.hoveredPart === mine.part) store.hoverPart(null);
  if (store.hoveredAssetCode === mine.assetCode) store.hoverAsset(null);
}

/**
 * The parts of a modelled asset with the reading each shows (frames 03, 05, 08): a tree of one or
 * two levels, every part open. The rows are the model's own (`partRows`, V2-14.10), the caller builds them.
 *
 * **Selecting (V2-15.11).** In the 3D view a *bound* row (one that follows a point) is selectable, and a static row
 * stays read-only, as its node is never a target in the scene (ADR-0020). Click, Enter or Space selects the part
 * (`selectPart`, which opens its callout) and flies the camera to it (`focusSelection`); doing it to the selected
 * row selects nothing again, as a second click on the part does in the scene. `aria-selected` says which row is
 * selected, whoever selected it, so a click on the blade in 3D marks the row. Hovering a row writes the hover the
 * pointer writes for a part (the asset **and** the part: the scene ignores a part hovered without its asset), and a
 * part hovered in the scene marks its row. In the 2D view there is no scene to show a selection in, so the rows are
 * read only, as they were: no control that does nothing.
 *
 * It is the ARIA tree pattern: one tab stop (a roving `tabIndex`), the arrow keys and Home / End move between rows
 * (`nextRowIndex`, as the feeds). Nothing collapses, so Left and Right have no meaning here.
 *
 * Values come from the `entry` the caller already holds, with no subscription of its own, so the inspector still
 * re-renders for its own asset's readings only; the selection and the hover are this list's own subscriptions (one
 * narrow selector each), so a hover re-renders the rows and not the inspector. `stale` is the caller's single fact
 * (as for `AssetReadings`).
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
  const inTwin = useConsole((s) => s.view === '3d');
  const selectedPart = useConsole((s) => s.selectedPart);
  const hoveredPart = useConsole((s) => s.hoveredPart);
  const hoveredAssetCode = useConsole((s) => s.hoveredAssetCode);
  const wrote = useRef<HoverWrite | null>(null);

  useEffect(() => () => takeBackHover(wrote), []);

  const activate = (row: PartRow) => {
    const store = useConsole.getState();
    if (store.selectedPart === row.name) {
      store.selectPart(null);
      return;
    }
    store.selectPart(row.name);
    focusSelection(assetCode, row.name);
  };

  const hover = (row: PartRow) => {
    const store = useConsole.getState();
    store.hoverAsset(assetCode);
    store.hoverPart(row.name);
    wrote.current = { assetCode, part: row.name };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number, row: PartRow) => {
    if (inTwin && row.bind !== null && (event.key === 'Enter' || event.key === ' ')) {
      // Space would scroll the sheet.
      event.preventDefault();
      activate(row);
      return;
    }
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
          // A static part is merged into the model at load and is never a target (ADR-0020).
          const selectable = inTwin && row.bind !== null;
          const hovered = selectable && hoveredAssetCode === assetCode && hoveredPart === row.name;
          return (
            <li
              key={row.name}
              ref={(element) => {
                rows.current[index] = element;
              }}
              role="treeitem"
              aria-level={row.parent === null ? 1 : 2}
              aria-expanded={parent ? true : undefined}
              aria-selected={selectable ? selectedPart === row.name : undefined}
              tabIndex={index === active ? 0 : -1}
              className={styles.row}
              data-level={row.parent === null ? 1 : 2}
              data-stale={stale && row.bind !== null ? 'true' : undefined}
              data-selectable={selectable ? 'true' : undefined}
              data-hovered={hovered ? 'true' : undefined}
              onFocus={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index, row)}
              onClick={selectable ? () => activate(row) : undefined}
              onMouseEnter={selectable ? () => hover(row) : undefined}
              onMouseLeave={selectable ? () => takeBackHover(wrote) : undefined}
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
