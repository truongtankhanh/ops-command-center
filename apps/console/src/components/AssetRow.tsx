import type { Asset, Incident } from '@occ/contracts';
import { memo, useCallback } from 'react';
import { rowValue, stateText } from '../lib/assetList';
import type { AssetState } from '../lib/assets';
import { severityLabel } from '../lib/incidents';
import { useAssetState } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { assetClassIcon, assetStateIcon, severityIcon, unknownIcon } from '../ui/icons';
import styles from './AssetRow.module.css';

interface AssetRowProps {
  asset: Asset;
  /** One word per asset, decided once by the list (`assetStates`). */
  state: AssetState;
  /** The unresolved incident of a fault: its severity is the row's tint and its code the state's. */
  incident: Incident | undefined;
  /**
   * How old the latest reading is, **only** when it is stale or its device is offline, whatever
   * the state word is (a fault is never hidden by a stale reading, but its values are still drawn
   * stale); `null` for every other row, so a live row's props never change with the clock.
   */
  ageMs: number | null;
  /** This row's key in the list's roving set (`assetKey`). */
  itemKey: string;
  /** The list's roving tab stop: `0` on one item, `-1` on the others. */
  tabIndex: 0 | -1;
  /** Stable, so memoizing the row holds: the list keeps the element to move focus to it. */
  register: (key: string, element: HTMLButtonElement | null) => void;
  onFocusItem: (key: string) => void;
}

/**
 * One asset in the Assets list (frames 02 and 05): its class glyph, name, first headline reading,
 * state and code. State and severity are words and glyphs as well as colour, and a stale value is
 * dimmed *and* says "No data · 1 min", so nothing rests on colour alone. A click or Enter / Space
 * selects the asset (a second one deselects, as an incident row does); hovering it sets
 * `hoveredAssetCode` for the map to follow (V2-10.4). Keyboard focus does not: an arrow walk down
 * the list would write the store on every key.
 *
 * Memoized, which the console does not do by default: the list re-renders every second with the
 * server clock, and the task's criterion is that only the rows whose asset changed re-render. Every
 * prop is a primitive or a stored reference for that reason; the row itself reads its asset's
 * telemetry entry, which the reducer keeps untouched until that asset changes.
 */
export const AssetRow = memo(function AssetRow({
  asset,
  state,
  incident,
  ageMs,
  itemKey,
  tabIndex,
  register,
  onFocusItem,
}: AssetRowProps) {
  const entry = useAssetState(asset.code);
  const selected = useConsole((s) => s.selectedAssetCode === asset.code);
  const selectAsset = useConsole((s) => s.selectAsset);
  const hoverAsset = useConsole((s) => s.hoverAsset);

  const ref = useCallback(
    (element: HTMLButtonElement | null) => register(itemKey, element),
    [register, itemKey],
  );

  const value = rowValue(asset, entry);
  const text = stateText(state, { ageMs, incidentCode: incident?.code });
  // The value is the last known one when the reading is stale or offline, and also under a fault.
  const stale = ageMs !== null || state === 'nodata' || state === 'offline';
  // A fault keeps its severity glyph; `unknown` has no word and so no glyph either.
  const stateGlyph =
    state === 'fault'
      ? incident && severityIcon(incident.severity)
      : state === 'unknown'
        ? undefined
        : assetStateIcon(state);
  const classGlyph = assetClassIcon(asset.class.code);
  // A class this build lacks (a newer API can send one) is named as it came.
  const rawClass = classGlyph === unknownIcon ? asset.class.code : null;

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      className={styles.row}
      data-state={state}
      data-severity={state === 'fault' ? incident?.severity : undefined}
      aria-current={selected}
      onFocus={() => onFocusItem(itemKey)}
      onClick={() => selectAsset(selected ? null : asset.code)}
      onMouseEnter={() => hoverAsset(asset.code)}
      onMouseLeave={() => hoverAsset(null)}
    >
      <span className={styles.tile}>
        <Icon glyph={classGlyph} size={18} />
      </span>
      <span className={styles.name}>{asset.name}</span>
      <span className={styles.value} data-stale={stale}>
        {value ?? '—'}
      </span>
      <span className={styles.meta}>
        {text !== null && (
          <span className={styles.state} data-state={state}>
            {stateGlyph && <Icon glyph={stateGlyph} size={14} />}
            {state === 'fault' && incident && (
              <span className={styles.hidden}>{severityLabel(incident.severity)} severity, </span>
            )}
            {text}
          </span>
        )}
        {rawClass !== null && <span className={styles.rawClass}>{rawClass}</span>}
        <span className={styles.code}>{asset.code}</span>
      </span>
    </button>
  );
});
