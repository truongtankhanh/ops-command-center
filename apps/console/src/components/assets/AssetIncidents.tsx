import type { Incident } from '@occ/contracts';
import { useNow } from '../../lib/shared/useNow';
import { useConsole } from '../../store';
import { Button } from '../../ui/Button';
import { SheetSection } from '../../ui/SheetSection';
import styles from './AssetIncidents.module.css';
import { IncidentRow } from '../incidents/IncidentRow';

/**
 * The incident(s) this asset raised (frame 15), drawn as the feed draws them. `incidents` is the
 * asset's unresolved ones in the feed's order and is never empty: with none, the head says "No open
 * incidents" and this section is not drawn (V2-09.9).
 *
 * Opening one selects it in the store, which closes the inspector (`select` clears the asset): the
 * sheet's own footer then decides what the user may do, per the category scope (ADR-0011). The
 * row is itself the control; the button is frame 15's and names the incident the head names.
 *
 * It owns the timer for the rows' ages, so only this section re-renders with it.
 */
export function AssetIncidents({ incidents }: { incidents: readonly Incident[] }) {
  const now = useNow();
  const select = useConsole((s) => s.select);
  const first = incidents[0];
  if (first === undefined) return null;

  const title = `${incidents.length > 1 ? 'Incidents' : 'Incident'} raised by this asset`;
  return (
    <SheetSection title={title}>
      <ul className={styles.list}>
        {incidents.map((incident) => (
          <li key={incident.id}>
            <IncidentRow incident={incident} now={now} />
          </li>
        ))}
      </ul>
      <Button className={styles.open} onClick={() => select(first.id)}>
        Open {first.code}
      </Button>
    </SheetSection>
  );
}
