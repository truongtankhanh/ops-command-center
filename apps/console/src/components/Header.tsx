import { useCallback } from 'react';
import { usePermission } from '../auth/usePermission';
import { useShortcut } from '../lib/shell/useShortcut';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Plus } from '../ui/icons';
import { Brand } from './Brand';
import { ConnectionPill, TelemetryPill } from './ConnectionPills';
import { HeaderClock } from './HeaderClock';
import styles from './Header.module.css';
import { KpiTiles } from './incidents/KpiTiles';
import { UserMenu } from './UserMenu';

/**
 * The app shell's header (frames 01, 04, 06). Each part reads its own slice of state, so the
 * clock's tick or a new count re-renders that part only, never the whole header.
 */
export function Header() {
  const canReport = usePermission('incident:report');
  const reporting = useConsole((s) => s.reporting);
  const startReport = useConsole((s) => s.startReport);
  const keysOn = useConsole((s) => s.keyboardShortcuts);
  // `startReport` takes an optional preset (the asset inspector's), so it is never the click
  // handler itself: the event would arrive as the preset.
  const openReport = useCallback(() => startReport(), [startReport]);

  // A note being written in the open incident survives the report form (`noteDrafts`), so `N` and
  // the button can always open it.
  useShortcut('n', openReport, canReport && !reporting);

  return (
    <header className={styles.header}>
      <Brand />
      <KpiTiles className={styles.kpis} />
      <div className={styles.conns}>
        <ConnectionPill />
        <TelemetryPill />
      </div>
      <HeaderClock />
      {canReport && (
        <Button
          variant="primary"
          icon={Plus}
          shortcut={keysOn ? 'N' : undefined}
          aria-expanded={reporting}
          aria-controls="report-incident-panel"
          onClick={openReport}
        >
          Report incident
        </Button>
      )}
      <UserMenu />
    </header>
  );
}
