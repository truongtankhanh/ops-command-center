import type { IncidentDetail as Detail, IncidentEventKind } from '@occ/contracts';
import { useCallback, useState } from 'react';
import { ApiRequestError, NO_LONGER_ALLOWED } from '../api/client';
import { useCameras, useIncident, useTransition, useZones } from '../api/queries';
import { usePermission } from '../auth/usePermission';
import { statusLabel, typeLabel } from '../lib/incidents';
import { useCloseOnEscape } from '../lib/useCloseOnEscape';
import { useConsole } from '../store';
import button from '../styles/button.module.css';
import panel from '../styles/panel.module.css';
import text from '../styles/text.module.css';
import { CameraTile } from './CameraTile';
import styles from './IncidentDetail.module.css';

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
  const close = useCallback(() => select(null), [select]);
  // Kept here rather than in the response form, so Escape knows whether closing would lose it.
  const [note, setNote] = useState('');

  useCloseOnEscape(close, note.trim() !== '');

  if (isPending) return <aside className={panel.panel} aria-busy="true" />;
  if (isError || !incident) {
    return (
      <aside className={panel.panel}>
        <p className={text.empty}>This incident could not be loaded.</p>
      </aside>
    );
  }
  return <DetailBody incident={incident} note={note} onNoteChange={setNote} onClose={close} />;
}

function DetailBody({
  incident,
  note,
  onNoteChange,
  onClose,
}: {
  incident: Detail;
  note: string;
  onNoteChange: (note: string) => void;
  onClose: () => void;
}) {
  const { data: zones = [] } = useZones();
  const { data: cameras = [] } = useCameras();
  const zone = zones.find((z) => z.id === incident.zoneId);
  const zoneCameras = cameras.filter((c) => c.zoneId === incident.zoneId).slice(0, 2);
  const canAcknowledge = usePermission('incident:acknowledge');
  const canResolve = usePermission('incident:resolve');
  const showAcknowledge = incident.status === 'open' && canAcknowledge;
  const showResolve = incident.status !== 'resolved' && canResolve;

  return (
    <aside className={panel.panel} aria-label={`Incident ${incident.code}`}>
      <div className={styles.head} data-severity={incident.severity} data-status={incident.status}>
        <div className={panel.toprow}>
          <span>{incident.code}</span>
          <button className={styles.close} onClick={onClose} aria-label="Close incident">
            Close
          </button>
        </div>
        <h2 className={panel.title}>{incident.title}</h2>
        <dl className={styles.facts}>
          <dt>Status</dt>
          <dd>{statusLabel(incident.status)}</dd>
          <dt>Severity</dt>
          <dd className={styles.severity}>{incident.severity}</dd>
          <dt>Type</dt>
          <dd>{typeLabel(incident.type)}</dd>
          <dt>Location</dt>
          <dd>{zone?.name ?? '—'}</dd>
          <dt>Reported by</dt>
          <dd>{incident.source === 'simulator' ? 'Sensor (simulated)' : 'Operator'}</dd>
        </dl>
        {incident.description && <p className={styles.description}>{incident.description}</p>}
      </div>

      {(showAcknowledge || showResolve) && (
        <Actions
          incident={incident}
          note={note}
          onNoteChange={onNoteChange}
          showAcknowledge={showAcknowledge}
          showResolve={showResolve}
        />
      )}

      <section className={styles.section}>
        <h3>Timeline</h3>
        <ol className={styles.timeline}>
          {incident.timeline.map((event) => (
            <li key={event.id} data-actor-kind={event.actor.kind}>
              <span className={styles.timelineKind}>{EVENT_LABEL[event.kind]}</span>
              <time className={styles.timelineTime} dateTime={event.at}>
                {time(event.at)}
              </time>
              <span className={styles.timelineActor}>{event.actor.displayName}</span>
              {event.note && <p className={styles.timelineNote}>{event.note}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <h3>Cameras in {zone?.name ?? 'this zone'}</h3>
        {zoneCameras.length === 0 ? (
          <p className={`${text.muted} ${styles.noCameras}`}>No cameras cover this zone.</p>
        ) : (
          <div className={styles.cameras}>
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
  note,
  onNoteChange,
  showAcknowledge,
  showResolve,
}: {
  incident: Detail;
  note: string;
  onNoteChange: (note: string) => void;
  showAcknowledge: boolean;
  showResolve: boolean;
}) {
  const acknowledge = useTransition('acknowledge');
  const resolve = useTransition('resolve');
  const busy = acknowledge.isPending || resolve.isPending;
  const error = acknowledge.error ?? resolve.error;

  const run = (mutation: typeof acknowledge) =>
    mutation.mutate(
      { id: incident.id, note: note.trim() || undefined },
      { onSuccess: () => onNoteChange('') },
    );

  return (
    <section className={styles.section}>
      <h3>Response</h3>
      <form className={styles.actionForm} onSubmit={(event) => event.preventDefault()}>
        <label className={text.muted} htmlFor="incident-note">
          Note for the timeline (optional)
        </label>
        <textarea
          id="incident-note"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="e.g. Guard dispatched from the main gate"
          maxLength={1000}
        />
        <div className={panel.actions}>
          {showAcknowledge && (
            <button
              type="button"
              className={button.button}
              data-variant="primary"
              disabled={busy}
              onClick={() => run(acknowledge)}
            >
              Acknowledge
            </button>
          )}
          {showResolve && (
            <button
              type="button"
              className={button.button}
              // Only one primary action at a time: Resolve is it once Acknowledge is gone.
              data-variant={showAcknowledge ? undefined : 'primary'}
              disabled={busy}
              onClick={() => run(resolve)}
            >
              Resolve
            </button>
          )}
        </div>
        {error && (
          <p className={panel.error} role="alert">
            {error instanceof ApiRequestError && error.status === 403
              ? NO_LONGER_ALLOWED
              : error.message}
          </p>
        )}
      </form>
    </section>
  );
}
