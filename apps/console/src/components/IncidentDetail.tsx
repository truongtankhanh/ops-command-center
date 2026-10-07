import type { IncidentDetail as Detail, IncidentEventKind } from '@occ/contracts';
import { useCallback, useState } from 'react';
import { ApiRequestError, NO_LONGER_ALLOWED } from '../api/client';
import { useCameras, useIncident, useTransition, useZones } from '../api/queries';
import { usePermission } from '../auth/usePermission';
import { typeLabel } from '../lib/incidents';
import { useConsole } from '../store';
import text from '../styles/text.module.css';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Field, Textarea } from '../ui/Field';
import { Hint } from '../ui/Hint';
import { SeverityBadge } from '../ui/SeverityBadge';
import { Sheet } from '../ui/Sheet';
import { StatusChip } from '../ui/StatusChip';
import { CameraTile } from './CameraTile';
import styles from './IncidentDetail.module.css';

const EVENT_LABEL: Record<IncidentEventKind, string> = {
  reported: 'Reported',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
};

/** Shown under a note being written, and announced by the sheet when Escape is ignored for it. */
const NOTE_KEPT = 'Esc keeps your note. Close discards it.';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The incident in the sheet. One `Sheet` holds the loading, failed and loaded states, so the data
 * arriving never moves focus. The note being written lives in the store (`noteDrafts`): leaving for
 * another incident or the report form keeps it, and only Close or a sent note clears it.
 */
export function IncidentDetail({ id }: { id: string }) {
  const { data: incident, isPending, isError } = useIncident(id);
  const select = useConsole((s) => s.select);
  const clearNote = useConsole((s) => s.clearNote);
  const hasDraft = useConsole((s) => (s.noteDrafts[id] ?? '').trim() !== '');
  const close = useCallback(() => {
    clearNote(id);
    select(null);
  }, [clearNote, id, select]);

  // Set when Escape was ignored to keep the note; forgotten once the note is gone, so a new note
  // starts with the plain hint again.
  const [kept, setKept] = useState(false);
  const [hadDraft, setHadDraft] = useState(hasDraft);
  if (hasDraft !== hadDraft) {
    setHadDraft(hasDraft);
    if (!hasDraft) setKept(false);
  }
  const keepNote = useCallback(() => setKept(true), []);

  return (
    <Sheet
      label={incident ? `Incident ${incident.code}` : 'Incident'}
      onClose={close}
      keepOpen={hasDraft}
      keptMessage={NOTE_KEPT}
      onEscapeKept={keepNote}
    >
      {isPending ? null : isError || !incident ? (
        <EmptyState>This incident could not be loaded.</EmptyState>
      ) : (
        <DetailBody incident={incident} hasDraft={hasDraft} kept={kept} onClose={close} />
      )}
    </Sheet>
  );
}

function DetailBody({
  incident,
  hasDraft,
  kept,
  onClose,
}: {
  incident: Detail;
  hasDraft: boolean;
  kept: boolean;
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
    <>
      <div className={styles.head} data-severity={incident.severity} data-status={incident.status}>
        <div className={styles.toprow}>
          <span>{incident.code}</span>
          <Button
            variant="ghost"
            size="sm"
            // Escape closes only while no note would be lost; the hint below says so then.
            shortcut={hasDraft ? undefined : 'Esc'}
            onClick={onClose}
            aria-label="Close incident"
          >
            Close
          </Button>
        </div>
        <h2 className={styles.title}>{incident.title}</h2>
        <dl className={styles.facts}>
          <dt>Status</dt>
          <dd>
            <StatusChip status={incident.status} form="pill" />
          </dd>
          <dt>Severity</dt>
          <dd>
            <SeverityBadge severity={incident.severity} />
          </dd>
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
          kept={kept}
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
    </>
  );
}

/** Only the actions the user's roles grant are shown; the API refuses the rest anyway (ADR-0011). */
function Actions({
  incident,
  kept,
  showAcknowledge,
  showResolve,
}: {
  incident: Detail;
  kept: boolean;
  showAcknowledge: boolean;
  showResolve: boolean;
}) {
  const note = useConsole((s) => s.noteDrafts[incident.id] ?? '');
  const setNote = useConsole((s) => s.setNote);
  const clearNote = useConsole((s) => s.clearNote);
  const acknowledge = useTransition('acknowledge');
  const resolve = useTransition('resolve');
  const busy = acknowledge.isPending || resolve.isPending;
  const error = acknowledge.error ?? resolve.error;

  const run = (mutation: typeof acknowledge) =>
    mutation.mutate(
      { id: incident.id, note: note.trim() || undefined },
      { onSuccess: () => clearNote(incident.id) },
    );

  return (
    <section className={styles.section}>
      <h3>Response</h3>
      <form className={styles.actionForm} onSubmit={(event) => event.preventDefault()}>
        <Field label="Note for the timeline (optional)">
          <Textarea
            className={styles.note}
            value={note}
            onChange={(event) => setNote(incident.id, event.target.value)}
            placeholder="e.g. Guard dispatched from the main gate"
            maxLength={1000}
          />
        </Field>
        {note.trim() !== '' && <Hint tone={kept ? 'warning' : 'info'}>{NOTE_KEPT}</Hint>}
        <div className={styles.actions}>
          {showAcknowledge && (
            <Button
              variant="primary"
              className={styles.grow}
              disabled={busy}
              onClick={() => run(acknowledge)}
            >
              Acknowledge
            </Button>
          )}
          {showResolve && (
            <Button
              // Only one primary action at a time: Resolve is it once Acknowledge is gone.
              variant={showAcknowledge ? 'secondary' : 'primary'}
              className={styles.grow}
              disabled={busy}
              onClick={() => run(resolve)}
            >
              Resolve
            </Button>
          )}
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error instanceof ApiRequestError && error.status === 403
              ? NO_LONGER_ALLOWED
              : error.message}
          </p>
        )}
      </form>
    </section>
  );
}
