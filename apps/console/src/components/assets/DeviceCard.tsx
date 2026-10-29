import type { IncidentSeverity } from '@occ/contracts';
import { Fragment, useId, useState } from 'react';
import type { DeviceInfoRow } from '../../lib/assets/deviceInfo';
import { severityLabel } from '../../lib/incidents/incidents';
import { Icon } from '../../ui/Icon';
import { assetStateIcon, ChevronDown, type Glyph, severityIcon } from '../../ui/icons';
import styles from './DeviceCard.module.css';

type StatusRow = Extract<DeviceInfoRow, { id: 'status' }>;
type BatteryRow = Extract<DeviceInfoRow, { id: 'battery' }>;

/**
 * The device information card (V3-09.3; frames 02 and 04): a titled card whose header collapses
 * the rows, so an operator who has read them can give the sheet's height to the live data.
 *
 * It draws the rows it is given and nothing else: `deviceInfoRows` (V3-09.2) decides which rows
 * exist (no battery for a class without the point, no location without a zone) and the caller feeds
 * it, so this holds no store, no query and no role check. The content is identical for every role.
 *
 * `severity` is the severity of the open incident when the device is in `fault`, which only the
 * caller knows (the same reason `assetStateIcon` has no glyph for a fault). Without it a fault is
 * drawn as its word alone: the pill never invents a severity.
 *
 * Collapsed state is local and starts open; the inspector remounts on every selection, so it is not
 * remembered between devices. The rows stay in the DOM while collapsed (`hidden`) so the header's
 * `aria-controls` always names something.
 */
export function DeviceCard({
  rows,
  severity,
}: {
  rows: readonly DeviceInfoRow[];
  severity?: IncidentSeverity;
}) {
  const [open, setOpen] = useState(true);
  const titleId = useId();
  const rowsId = useId();

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.card}>
        <h3 className={styles.title} id={titleId}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={rowsId}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            Device information
            <Icon glyph={ChevronDown} size={16} className={styles.chevron} />
          </button>
        </h3>
        <dl id={rowsId} className={styles.rows} hidden={!open}>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <dt>{row.label}</dt>
              <dd data-row={row.id}>
                {row.id === 'status' ? (
                  <StatusPill row={row} severity={severity} />
                ) : row.id === 'battery' ? (
                  <Battery row={row} />
                ) : (
                  row.value
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** A fault keeps its incident's severity glyph; `unknown` has no word and so no glyph. */
function statusGlyph(
  state: StatusRow['state'],
  severity: IncidentSeverity | undefined,
): Glyph | undefined {
  switch (state) {
    case 'fault':
      return severity === undefined ? undefined : severityIcon(severity);
    case 'unknown':
      return undefined;
    default:
      return assetStateIcon(state);
  }
}

/** The glyph and the bare word, as the asset head's pill; a fault with a severity also says it. */
function StatusPill({ row, severity }: { row: StatusRow; severity: IncidentSeverity | undefined }) {
  const glyph = statusGlyph(row.state, severity);
  const faultSeverity = row.state === 'fault' ? severity : undefined;
  return (
    <span className={styles.pill} data-state={row.state} data-severity={faultSeverity}>
      {glyph && <Icon glyph={glyph} size={14} />}
      {faultSeverity !== undefined && (
        <span className={styles.hidden}>{`${severityLabel(faultSeverity)} severity, `}</span>
      )}
      {row.text}
    </span>
  );
}

/**
 * The figure beside a bar. The bar is decorative: the text is the reading, and a bar of no hue
 * says nothing the figure does not. There is no threshold in the catalogue, so no colour judges a
 * level (V3-09.3, D2); a reading outside 0 to 100 is clamped to the bar and still written as it came.
 */
function Battery({ row }: { row: BatteryRow }) {
  return (
    <span className={styles.battery}>
      <span className={styles.bar} aria-hidden="true">
        {row.percent !== null && (
          <span
            className={styles.fill}
            style={{ width: `${Math.min(100, Math.max(0, row.percent))}%` }}
          />
        )}
      </span>
      <span>{row.text}</span>
    </span>
  );
}
