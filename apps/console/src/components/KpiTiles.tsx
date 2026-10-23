import { INCIDENT_SEVERITIES, type Incident } from '@occ/contracts';
import { useIncidents } from '../api/queries';
import { countActiveBySeverity, severityLabel } from '../lib/incidents/incidents';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { severityIcon } from '../ui/icons';
import styles from './KpiTiles.module.css';

/**
 * Active incidents per severity, most severe first (frames 01 and 04). Each tile is a toggle that
 * filters the feed by its severity; zero-count tiles stay pressable, so an operator can watch
 * "Critical only" before one arrives. The critical tile escalates while any is active.
 *
 * `readOnly` (the video wall's header, V2-21.3) draws the same tiles as text: nothing to press, no pressed state and no
 * filter, because nobody at a wall can use one.
 */
export function KpiTiles({
  className,
  readOnly = false,
}: {
  className?: string;
  readOnly?: boolean;
}) {
  const { data: incidents = [] } = useIncidents();
  const selected = useConsole((s) => s.severity);
  const toggleSeverity = useConsole((s) => s.toggleSeverity);
  const counts = countActiveBySeverity(incidents);

  return (
    <ul
      className={className ? `${styles.tiles} ${className}` : styles.tiles}
      aria-label={
        readOnly
          ? 'Active incidents by severity'
          : 'Active incidents by severity — select to filter the feed'
      }
    >
      {[...INCIDENT_SEVERITIES].reverse().map((severity) => {
        const count = counts[severity];
        return (
          <li key={severity}>
            {readOnly ? (
              <div
                className={styles.tile}
                data-severity={severity}
                data-zero={count === 0}
                data-hot={severity === 'critical' && count > 0}
                data-readonly="true"
              >
                <Tile severity={severity} count={count} />
              </div>
            ) : (
              <button
                type="button"
                className={styles.tile}
                data-severity={severity}
                data-zero={count === 0}
                data-hot={severity === 'critical' && count > 0}
                aria-pressed={selected === severity}
                onClick={() => toggleSeverity(severity)}
              >
                <Tile severity={severity} count={count} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What a tile holds: the severity's glyph, the count and the word. */
function Tile({ severity, count }: { severity: Incident['severity']; count: number }) {
  return (
    <>
      <Icon glyph={severityIcon(severity)} size={20} className={styles.icon} />
      {/* The space keeps the accessible name "1 Critical", not "1Critical". */}
      <span className={styles.count}>{count}</span>{' '}
      <span className={styles.label}>{severityLabel(severity)}</span>
    </>
  );
}
