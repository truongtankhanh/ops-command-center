import type { ReactNode } from 'react';
import styles from './App.module.css';
import { AssetFeed } from './components/AssetFeed';
import { AssetInspector } from './components/AssetInspector';
import { CameraStrip } from './components/cameras/CameraStrip';
import { CameraViewer } from './components/cameras/CameraViewer';
import { Header } from './components/Header';
import { IncidentDetail } from './components/incidents/IncidentDetail';
import { IncidentFeed } from './components/incidents/IncidentFeed';
import { RegionFallback } from './components/LoadStates';
import { OfflineBanner } from './components/OfflineBanner';
import { ReportIncidentForm } from './components/incidents/ReportIncidentForm';
import { ShortcutHelp } from './components/ShortcutHelp';
import { SidePanel } from './components/SidePanel';
import { StageView } from './components/StageView';
import { TelemetryBanner } from './components/TelemetryBanner';
import { TelemetryWatchSet } from './components/TelemetryWatchSet';
import { TwinFallbackBanner } from './components/TwinFallbackBanner';
import { TwinShortcuts } from './components/TwinShortcuts';
import { WallApp } from './components/wall/WallApp';
import { useAudioUnlock } from './lib/incidents/criticalCue';
import { useDensityAttribute } from './lib/shell/density';
import { useAttentionBadge } from './lib/incidents/useAttentionBadge';
import { useLiveIncidents } from './realtime/useLiveIncidents';
import { useTelemetry } from './realtime/useTelemetry';
import { useConsole } from './store';
import { Button } from './ui/Button';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Sheet, SheetHost } from './ui/Sheet';
import { ToastRegion } from './ui/Toast';

/** In order of preference; the last one is the Assets panel's, for when the incidents are hidden. */
const FEED_FOCUS_TARGETS = [
  '#incident-feed ul [tabindex="0"]',
  '#incident-feed input[type="search"]',
  '#asset-feed input[type="search"]',
];

/**
 * Where focus goes when a dismissed toast held it and nothing nearer is left (see `ToastRegion`):
 * the feed row that holds the feed's tab stop, else the feed's search box. Both side panels stay
 * mounted, and a hidden one cannot take focus, so the first target that is shown wins and the
 * Assets panel's search box stands in while the incidents are hidden.
 */
const feedFocusTarget = () => {
  for (const selector of FEED_FOCUS_TARGETS) {
    const target = document.querySelector<HTMLElement>(selector);
    if (target && target.closest('[hidden]') === null) return target;
  }
  return null;
};

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

/** Display preferences set on `<html>` (density), so they also reach the portalled dialogs. */
function DisplayPreferences() {
  useDensityAttribute(useConsole((s) => s.density));
  return null;
}

/**
 * The console, or, in a window opened as a video wall screen (`?wall=N`, V2-21.2), the wall. The two live hooks stay
 * on either way: the wall shows the same incidents and readings. Nothing else of the console is mounted on a wall: no
 * shortcut, toast, sheet, form, account menu, camera viewer or audio unlock, so there is nothing to press and
 * nothing that makes a sound. `TelemetryWatchSet` stays (it watches nothing until something is selected), and the
 * display preferences, which only set attributes on `<html>`.
 */
export function App() {
  useLiveIncidents();
  useTelemetry();
  const wall = useConsole((s) => s.wall);
  if (wall === null) return <Console />;
  return (
    <>
      <DisplayPreferences />
      <TelemetryWatchSet />
      <WallApp screen={wall} />
    </>
  );
}

function Console() {
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const selectedAssetCode = useConsole((s) => s.selectedAssetCode);
  const reporting = useConsole((s) => s.reporting);
  const sheetOpen = reporting || selectedAssetCode !== null || selectedId !== null;
  // What the sheet holds. The store keeps the three exclusive, so at most one of them applies.
  const sheet: SheetContent = reporting
    ? 'report'
    : selectedAssetCode !== null
      ? 'asset'
      : 'incident';

  return (
    <div className={styles.console}>
      <AttentionSignals />
      <DisplayPreferences />
      <TelemetryWatchSet />
      <TwinShortcuts />
      <Header />
      {/* One host for both contents: switching between them keeps the sheet's opener (UI-10). */}
      <SheetHost>
        <main className={styles.workspace}>
          {/*
            Each region has its own error boundary: one that breaks leaves the others working. The
            side panel holds two (the incident list and the asset list), so a crash in one never
            takes the other, and the switch between them, with it.
          */}
          <SidePanel
            incidents={
              <Region
                label="Incidents"
                message="The incident list stopped working."
                className={styles.feedFallback}
              >
                <IncidentFeed />
              </Region>
            }
            assets={
              <Region
                label="Assets"
                message="The asset list stopped working."
                className={styles.feedFallback}
              >
                <AssetFeed />
              </Region>
            }
          />
          {/* The sheet lies over the stage, so opening it never resizes the map. */}
          <div className={styles.stage} data-sheet={sheetOpen ? 'open' : undefined}>
            <Region label="Campus map" message="The map stopped working.">
              <StageView />
            </Region>
            <Region
              label="Cameras"
              message="The camera strip stopped working."
              className={styles.stripFallback}
            >
              <CameraStrip />
            </Region>
            {sheetOpen && (
              // Keyed by the content, so opening another incident, an asset or the report form
              // starts afresh after a crash.
              <ErrorBoundary
                key={
                  sheet === 'report'
                    ? 'report'
                    : sheet === 'asset'
                      ? `asset:${selectedAssetCode}`
                      : `incident:${selectedId}`
                }
                region={sheet === 'asset' ? 'Asset panel' : 'Incident panel'}
                fallback={(retry) => <SheetFallback content={sheet} retry={retry} />}
              >
                {sheet === 'report' ? (
                  <ReportIncidentForm />
                ) : sheet === 'asset' ? (
                  selectedAssetCode && (
                    <AssetInspector key={selectedAssetCode} code={selectedAssetCode} />
                  )
                ) : (
                  selectedId && <IncidentDetail key={selectedId} id={selectedId} />
                )}
              </ErrorBoundary>
            )}
            {/* Each mounts only while its condition holds; an empty wrapper has no size. */}
            <div className={styles.banners}>
              <OfflineBanner />
              <TelemetryBanner />
              {/* Last: the one that matters least, and the one the operator can dismiss. */}
              <TwinFallbackBanner />
            </div>
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

/** What the sheet holds: the report form, an asset in the inspector, or an incident's detail. */
type SheetContent = 'report' | 'asset' | 'incident';

const FALLBACK_LABELS: Record<SheetContent, string> = {
  report: 'Report an incident',
  asset: 'Asset',
  incident: 'Incident',
};

/**
 * The sheet's fallback is a sheet too, so the stage keeps its layout and the operator can close it
 * (Close or Escape). Retry remounts the detail, the inspector or the report form; a report draft is
 * lost with it (Q5), a note draft is not (it lives in the store).
 */
function SheetFallback({ content, retry }: { content: SheetContent; retry: () => void }) {
  const select = useConsole((s) => s.select);
  const selectAsset = useConsole((s) => s.selectAsset);
  // `select(null)` clears the incident and closes the report form alike, but leaves the asset on
  // purpose (closing an incident is not deselecting the asset), so an asset has its own close.
  const close = () => (content === 'asset' ? selectAsset(null) : select(null));
  const label = FALLBACK_LABELS[content];
  return (
    <Sheet
      id={content === 'report' ? 'report-incident-panel' : undefined}
      label={label}
      onClose={close}
    >
      <div className={styles.sheetFallbackHead}>
        <Button variant="ghost" size="sm" shortcut="Esc" onClick={close}>
          Close
        </Button>
      </div>
      <RegionFallback label={label} message="This panel stopped working." retry={retry} />
    </Sheet>
  );
}
