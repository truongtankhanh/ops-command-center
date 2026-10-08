import type { ReactNode } from 'react';
import styles from './App.module.css';
import { CameraStrip } from './components/CameraStrip';
import { CameraViewer } from './components/CameraViewer';
import { CampusMap } from './components/CampusMap';
import { Header } from './components/Header';
import { IncidentDetail } from './components/IncidentDetail';
import { IncidentFeed } from './components/IncidentFeed';
import { RegionFallback } from './components/LoadStates';
import { OfflineBanner } from './components/OfflineBanner';
import { ReportIncidentForm } from './components/ReportIncidentForm';
import { ShortcutHelp } from './components/ShortcutHelp';
import { useAudioUnlock } from './lib/criticalCue';
import { useAttentionBadge } from './lib/useAttentionBadge';
import { useLiveIncidents } from './realtime/useLiveIncidents';
import { useConsole } from './store';
import { Button } from './ui/Button';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Sheet, SheetHost } from './ui/Sheet';
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
          {/* Each region has its own error boundary: one that breaks leaves the others working. */}
          <Region
            label="Incidents"
            message="The incident list stopped working."
            className={styles.feedFallback}
          >
            <IncidentFeed />
          </Region>
          {/* The sheet lies over the stage, so opening it never resizes the map. */}
          <div className={styles.stage} data-sheet={sheetOpen ? 'open' : undefined}>
            <Region label="Campus map" message="The map stopped working.">
              <CampusMap />
            </Region>
            <Region
              label="Cameras"
              message="The camera strip stopped working."
              className={styles.stripFallback}
            >
              <CameraStrip />
            </Region>
            {sheetOpen && (
              // Keyed by the content, so opening another incident or the report form starts afresh
              // after a crash.
              <ErrorBoundary
                key={reporting ? 'report' : selectedId}
                region="Incident panel"
                fallback={(retry) => <SheetFallback reporting={reporting} retry={retry} />}
              >
                {reporting ? (
                  <ReportIncidentForm />
                ) : (
                  selectedId && <IncidentDetail key={selectedId} id={selectedId} />
                )}
              </ErrorBoundary>
            )}
            <OfflineBanner />
            {/* Over the stage beside the sheet, so a toast never covers the incident it is about. */}
            <ToastRegion fallbackFocus={feedFocusTarget} />
          </div>
        </main>
      </SheetHost>
      {/* One viewer for the strip, the detail's tiles and the map's cameras; a modal over everything. */}
      <CameraViewer />
      <ShortcutHelp />
    </div>
  );
}

/** A region of the console behind its own error boundary, with a Retry in its place if it breaks. */
function Region({
  label,
  message,
  className,
  children,
}: {
  /** The region's accessible name, also the name in the error log. */
  label: string;
  message: string;
  /** Keeps the fallback in the region's place and look (the grids are positional). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <ErrorBoundary
      region={label}
      fallback={(retry) => (
        <RegionFallback label={label} message={message} retry={retry} className={className} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * The sheet's fallback is a sheet too, so the stage keeps its layout and the operator can close it
 * (Close or Escape). Retry remounts the detail or the report form; a report draft is lost with it
 * (Q5), a note draft is not (it lives in the store).
 */
function SheetFallback({ reporting, retry }: { reporting: boolean; retry: () => void }) {
  // Clears the selection and closes the report form alike.
  const select = useConsole((s) => s.select);
  const close = () => select(null);
  const label = reporting ? 'Report an incident' : 'Incident';
  return (
    <Sheet id={reporting ? 'report-incident-panel' : undefined} label={label} onClose={close}>
      <div className={styles.sheetFallbackHead}>
        <Button variant="ghost" size="sm" shortcut="Esc" onClick={close}>
          Close
        </Button>
      </div>
      <RegionFallback label={label} message="This panel stopped working." retry={retry} />
    </Sheet>
  );
}
