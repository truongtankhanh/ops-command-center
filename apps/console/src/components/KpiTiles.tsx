import { INCIDENT_SEVERITIES } from '@occ/contracts';
import { useIncidents } from '../api/queries';
import { countActiveBySeverity, severityLabel } from '../lib/incidents';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { severityIcon } from '../ui/icons';
import styles from './KpiTiles.module.css';

/**
 * Active incidents per severity, most severe first (frames 01 and 04). Each tile is a toggle that
 * filters the feed by its severity; zero-count tiles stay pressable, so an operator can watch
 * "Critical only" before one arrives. The critical tile escalates while any is active.
 */
export function KpiTiles({ className }: { className?: string }) {
  const { data: incidents = [] } = useIncidents();
  const selected = useConsole((s) => s.severity);
  const toggleSeverity = useConsole((s) => s.toggleSeverity);
  const counts = countActiveBySeverity(incidents);

  return (
    <ul
      className={className ? `${styles.tiles} ${className}` : styles.tiles}
      aria-label="Active incidents by severity — select to filter the feed"
    >
      {[...INCIDENT_SEVERITIES].reverse().map((severity) => {
        const count = counts[severity];
        return (
          <li key={severity}>
            <button
              type="button"
              className={styles.tile}
              data-severity={severity}
              data-zero={count === 0}
              data-hot={severity === 'critical' && count > 0}
              aria-pressed={selected === severity}
              onClick={() => toggleSeverity(severity)}
            >
              <Icon glyph={severityIcon(severity)} size={20} className={styles.icon} />
              {/* The space keeps the accessible name "1 Critical", not "1Critical". */}
              <span className={styles.count}>{count}</span>{' '}
              <span className={styles.label}>{severityLabel(severity)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
