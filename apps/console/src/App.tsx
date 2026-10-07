import styles from './App.module.css';
import { CameraStrip } from './components/CameraStrip';
import { CampusMap } from './components/CampusMap';
import { Header } from './components/Header';
import { IncidentDetail } from './components/IncidentDetail';
import { IncidentFeed } from './components/IncidentFeed';
import { ReportIncidentForm } from './components/ReportIncidentForm';
import { useLiveIncidents } from './realtime/useLiveIncidents';
import { useConsole } from './store';
import { SheetHost } from './ui/Sheet';

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
          </div>
        </main>
      </SheetHost>
    </div>
  );
}
