import styles from './App.module.css';
import { CameraStrip } from './components/CameraStrip';
import { CameraViewer } from './components/CameraViewer';
import { CampusMap } from './components/CampusMap';
import { Header } from './components/Header';
import { IncidentDetail } from './components/IncidentDetail';
import { IncidentFeed } from './components/IncidentFeed';
import { ReportIncidentForm } from './components/ReportIncidentForm';
import { useLiveIncidents } from './realtime/useLiveIncidents';
import { useConsole } from './store';
import { SheetHost } from './ui/Sheet';
import { ToastRegion } from './ui/Toast';

export function App() {
  useLiveIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const reporting = useConsole((s) => s.reporting);
  const sheetOpen = reporting || selectedId !== null;

  return (
    <div className={styles.console}>
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
            <ToastRegion />
          </div>
        </main>
      </SheetHost>
      {/* One viewer for the strip, the detail's tiles and the map's cameras; a modal over everything. */}
      <CameraViewer />
    </div>
  );
}
