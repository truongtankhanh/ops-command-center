import { CameraStrip } from './components/CameraStrip';
import { CampusMap } from './components/CampusMap';
import { Header } from './components/Header';
import { IncidentDetail } from './components/IncidentDetail';
import { IncidentFeed } from './components/IncidentFeed';
import { ReportIncidentForm } from './components/ReportIncidentForm';
import { useLiveIncidents } from './realtime/useLiveIncidents';
import { useConsole } from './store';

export function App() {
  useLiveIncidents();
  const selectedId = useConsole((s) => s.selectedIncidentId);
  const reporting = useConsole((s) => s.reporting);

  return (
    <div className="console">
      <Header />
      <main className={selectedId || reporting ? 'workspace has-detail' : 'workspace'}>
        <IncidentFeed />
        <div className="stage">
          <CampusMap />
          <CameraStrip />
        </div>
        {reporting ? (
          <ReportIncidentForm />
        ) : (
          selectedId && <IncidentDetail key={selectedId} id={selectedId} />
        )}
      </main>
    </div>
  );
}
