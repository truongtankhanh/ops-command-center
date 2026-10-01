import { CameraStrip } from './components/CameraStrip';
import { CampusMap } from './components/CampusMap';
import { Header } from './components/Header';
import { IncidentDetail } from './components/IncidentDetail';
import { IncidentFeed } from './components/IncidentFeed';
import { useLiveIncidents } from './realtime/useLiveIncidents';
import { useConsole } from './store';

export function App() {
  useLiveIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);

  return (
    <div className="console">
      <Header />
      <main className={selectedId ? 'workspace has-detail' : 'workspace'}>
        <IncidentFeed />
        <div className="stage">
          <CampusMap />
          <CameraStrip />
        </div>
        {selectedId && <IncidentDetail key={selectedId} id={selectedId} />}
      </main>
    </div>
  );
}
