import styles from './App.module.css';
import { CameraStrip } from './components/CameraStrip';
import { CameraViewer } from './components/CameraViewer';
import { CampusMap } from './components/CampusMap';
import { Header } from './components/Header';
import { IncidentDetail } from './components/IncidentDetail';
import { IncidentFeed } from './components/IncidentFeed';
import { ReportIncidentForm } from './components/ReportIncidentForm';
import { useAudioUnlock } from './lib/criticalCue';
import { useAttentionBadge } from './lib/useAttentionBadge';
import { useLiveIncidents } from './realtime/useLiveIncidents';
import { useConsole } from './store';
import { SheetHost } from './ui/Sheet';
import { ToastRegion } from './ui/Toast';

/**
 * Where focus goes when a dismissed toast held it and nothing nearer is left (see `ToastRegion`):
 * the feed row that holds the feed's tab stop, else the feed's search box.
 */
const feedFocusTarget = () =>
  document.querySelector<HTMLElement>('#incident-feed ul [tabindex="0"]') ??
  document.querySelector<HTMLElement>('#incident-feed input[type="search"]');

/**
 * The tab title / favicon badge and the audio unlock. A component of its own, so the incident list
 * it reads re-renders only this, not the whole console, on every live event.
 */
function AttentionSignals() {
  useAttentionBadge();
  const criticalSound = useConsole((s) => s.criticalSound);
  useAudioUnlock(criticalSound);
  return null;
}

export function App() {
  useLiveIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const reporting = useConsole((s) => s.reporting);
  const sheetOpen = reporting || selectedId !== null;

  return (
    <div className={styles.console}>
      <AttentionSignals />
      <Header />
      {/* One host for both contents: switching between them keeps the sheet's opener (UI-10). */}
      <SheetHost>
        <main className={styles.workspace}>
          <IncidentFeed />
          {/* The sheet lies over the stage, so opening it never resizes the map. */}
          <div className={styles.stage} data-sheet={sheetOpen ? 'open' : undefined}>
            <CampusMap />
            <CameraStrip />
            {reporting ? (
              <ReportIncidentForm />
            ) : (
              selectedId && <IncidentDetail key={selectedId} id={selectedId} />
            )}
            {/* Over the stage beside the sheet, so a toast never covers the incident it is about. */}
            <ToastRegion fallbackFocus={feedFocusTarget} />
          </div>
        </main>
      </SheetHost>
      {/* One viewer for the strip, the detail's tiles and the map's cameras; a modal over everything. */}
      <CameraViewer />
    </div>
  );
}
