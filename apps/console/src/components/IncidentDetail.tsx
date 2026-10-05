import type { IncidentDetail as Detail, IncidentEventKind } from '@occ/contracts';
import { useEffect, useState } from 'react';
import { ApiRequestError, NO_LONGER_ALLOWED } from '../api/client';
import { useCameras, useIncident, useTransition, useZones } from '../api/queries';
import { usePermission } from '../auth/usePermission';
import { statusLabel, typeLabel } from '../lib/incidents';
import { useConsole } from '../store';
import { CameraTile } from './CameraTile';

const EVENT_LABEL: Record<IncidentEventKind, string> = {
  reported: 'Reported',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function IncidentDetail({ id }: { id: string }) {
  const { data: incident, isPending, isError } = useIncident(id);
  const select = useConsole((s) => s.select);

  // Escape closes the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && select(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  if (isPending) return <aside className="detail" aria-busy="true" />;
  if (isError || !incident) {
    return (
      <aside className="detail">
        <p className="feed-empty">This incident could not be loaded.</p>
      </aside>
    );
  }
  return <DetailBody incident={incident} onClose={() => select(null)} />;
}

function DetailBody({ incident, onClose }: { incident: Detail; onClose: () => void }) {
  const { data: zones = [] } = useZones();
  const { data: cameras = [] } = useCameras();
  const zone = zones.find((z) => z.id === incident.zoneId);
  const zoneCameras = cameras.filter((c) => c.zoneId === incident.zoneId).slice(0, 2);
  const canAcknowledge = usePermission('incident:acknowledge');
  const canResolve = usePermission('incident:resolve');
  const showAcknowledge = incident.status === 'open' && canAcknowledge;
  const showResolve = incident.status !== 'resolved' && canResolve;

  return (
    <aside className="detail" aria-label={`Incident ${incident.code}`}>
      <div className="detail-head" data-severity={incident.severity} data-status={incident.status}>
        <div className="detail-toprow">
          <span>{incident.code}</span>
          <button className="detail-close" onClick={onClose} aria-label="Close incident">
            Close
          </button>
        </div>
        <h2 className="detail-title">{incident.title}</h2>
        <dl className="detail-facts">
          <dt>Status</dt>
          <dd>{statusLabel(incident.status)}</dd>
          <dt>Severity</dt>
          <dd style={{ textTransform: 'capitalize' }}>{incident.severity}</dd>
          <dt>Type</dt>
          <dd>{typeLabel(incident.type)}</dd>
          <dt>Location</dt>
          <dd>{zone?.name ?? '—'}</dd>
          <dt>Reported by</dt>
          <dd>{incident.source === 'simulator' ? 'Sensor (simulated)' : 'Operator'}</dd>
        </dl>
        {incident.description && <p className="detail-description">{incident.description}</p>}
      </div>

      {(showAcknowledge || showResolve) && (
        <Actions incident={incident} showAcknowledge={showAcknowledge} showResolve={showResolve} />
      )}

      <section className="detail-section">
        <h3>Timeline</h3>
        <ol className="timeline">
          {incident.timeline.map((event) => (
            <li key={event.id} data-actor-kind={event.actor.kind}>
              <span className="timeline-kind">{EVENT_LABEL[event.kind]}</span>
              <time className="timeline-time" dateTime={event.at}>
                {time(event.at)}
              </time>
              <span className="timeline-actor">{event.actor.displayName}</span>
              {event.note && <p className="timeline-note">{event.note}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section className="detail-section">
        <h3>Cameras in {zone?.name ?? 'this zone'}</h3>
        {zoneCameras.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No cameras cover this zone.
          </p>
        ) : (
          <div className="detail-cameras">
            {zoneCameras.map((camera) => (
              <CameraTile key={camera.id} camera={camera} />
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

/** Only the actions the user's roles grant are shown; the API refuses the rest anyway (ADR-0011). */
function Actions({
  incident,
  showAcknowledge,
  showResolve,
}: {
  incident: Detail;
  showAcknowledge: boolean;
  showResolve: boolean;
}) {
  const [note, setNote] = useState('');
  const acknowledge = useTransition('acknowledge');
  const resolve = useTransition('resolve');
  const busy = acknowledge.isPending || resolve.isPending;
  const error = acknowledge.error ?? resolve.error;

  const run = (mutation: typeof acknowledge) =>
    mutation.mutate(
      { id: incident.id, note: note.trim() || undefined },
      { onSuccess: () => setNote('') },
    );

  return (
    <section className="detail-section">
      <h3>Response</h3>
      <form className="action-form" onSubmit={(event) => event.preventDefault()}>
        <label className="muted" htmlFor="incident-note">
          Note for the timeline (optional)
        </label>
        <textarea
          id="incident-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Guard dispatched from the main gate"
          maxLength={1000}
        />
        <div className="action-buttons">
          {showAcknowledge && (
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => run(acknowledge)}
            >
              Acknowledge
            </button>
          )}
          {showResolve && (
            <button
              type="button"
              className={showAcknowledge ? 'button' : 'button button-primary'}
              disabled={busy}
              onClick={() => run(resolve)}
            >
              Resolve
            </button>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error instanceof ApiRequestError && error.status === 403
              ? NO_LONGER_ALLOWED
              : error.message}
          </p>
        )}
      </form>
    </section>
  );
}
