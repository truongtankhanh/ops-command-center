import type { IncidentDetail as Detail } from '@occ/contracts';
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ApiRequestError, isRateLimited } from '../api/client';
import { useCameras, useIncident, useZones } from '../api/queries';
import { categoryLabel, categoryOfType, typeLabel } from '../lib/incidents';
import { useConsole } from '../store';
import text from '../styles/text.module.css';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { focusLost } from '../ui/focus';
import { Icon } from '../ui/Icon';
import { actorKindIcon, categoryIcon, incidentTypeIcon, zoneKindIcon } from '../ui/icons';
import { SeverityBadge } from '../ui/SeverityBadge';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { CameraTile } from './CameraTile';
import styles from './IncidentDetail.module.css';
import { IncidentLifecycle } from './IncidentLifecycle';
import { IncidentResponse, NOTE_KEPT } from './IncidentResponse';
import { IncidentTimeline } from './IncidentTimeline';
import { LoadFailed, RateLimited } from './LoadStates';

/**
 * The incident in the sheet (frames 02 / 06). One `Sheet` holds the loading, failed and loaded
 * states, so the data arriving never moves focus. The note being written lives in the store
 * (`noteDrafts`): leaving for another incident or the report form keeps it, and only Close or a
 * sent note clears it.
 *
 * Once the incident is resolved — here or by someone else — the response footer goes. If focus was
 * in it, focus moves to the sheet, so Escape still reaches it. (An acknowledge keeps the footer:
 * `IncidentResponse` moves focus to Resolve.)
 */
export function IncidentDetail({ id }: { id: string }) {
  const { data: incident, error, failureReason, isPending, isFetching, refetch } = useIncident(id);
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

  const sheetRef = useRef<HTMLElement>(null);
  const status = incident?.status;
  const previousStatus = useRef(status);
  useLayoutEffect(() => {
    // From no status to one is the incident loading, not a transition.
    const previous = previousStatus.current;
    previousStatus.current = status;
    const resolvedNow = previous !== undefined && previous !== status && status === 'resolved';
    if (resolvedNow && focusLost()) sheetRef.current?.focus({ preventScroll: true });
  }, [status]);

  // Escape closes only while no note would be lost; the hint under the note says so then.
  const closeButton = (
    <Button
      variant="ghost"
      size="sm"
      shortcut={hasDraft ? undefined : 'Esc'}
      onClick={close}
      aria-label="Close incident"
    >
      Close
    </Button>
  );

  return (
    <Sheet
      ref={sheetRef}
      label={incident ? `Incident ${incident.code}` : 'Incident'}
      onClose={close}
      keepOpen={hasDraft}
      keptMessage={NOTE_KEPT}
      onEscapeKept={keepNote}
    >
      {/* Data first: a failed background refetch keeps the incident on screen (TanStack keeps it). */}
      {incident ? (
        <DetailBody incident={incident} kept={kept} closeButton={closeButton} />
      ) : isPending && !isRateLimited(failureReason) ? (
        <DetailSkeleton closeButton={closeButton} />
      ) : (
        <>
          <div className={styles.head}>
            <TopRow closeButton={closeButton} />
          </div>
          {isPending ? (
            <RateLimited />
          ) : error instanceof ApiRequestError && error.status === 404 ? (
            <EmptyState>This incident no longer exists.</EmptyState>
          ) : (
            <LoadFailed
              error={error}
              fallback="This incident could not be loaded."
              isFetching={isFetching}
              onRetry={() => void refetch()}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

function TopRow({ code, closeButton }: { code?: ReactNode; closeButton: ReactNode }) {
  return (
    <div className={styles.toprow}>
      <span className={styles.code}>{code}</span>
      {closeButton}
    </div>
  );
}

/** Laid out like the loaded head and timeline, so nothing jumps when the incident arrives. */
function DetailSkeleton({ closeButton }: { closeButton: ReactNode }) {
  return (
    <div className={styles.head} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading incident…
      </p>
      <TopRow code={<Skeleton className={styles.skeletonCode} />} closeButton={closeButton} />
      <div className={styles.badges}>
        {/* Severity, type, category and zone: the common loaded head. */}
        <Skeleton className={styles.skeletonBadge} />
        <Skeleton className={styles.skeletonBadge} />
        <Skeleton className={styles.skeletonBadge} />
        <Skeleton className={styles.skeletonBadge} />
      </div>
      <Skeleton className={styles.skeletonTitle} />
      <Skeleton className={styles.skeletonStepper} />
      <div className={styles.skeletonMetrics}>
        <Skeleton className={styles.skeletonMetric} />
        <Skeleton className={styles.skeletonMetric} />
      </div>
      <div className={styles.skeletonTimeline}>
        {[0, 1].map((row) => (
          <div key={row} className={styles.skeletonEntry}>
            <Skeleton shape="circle" className={styles.skeletonBadgeIcon} />
            <Skeleton className={styles.skeletonLine} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailBody({
  incident,
  kept,
  closeButton,
}: {
  incident: Detail;
  kept: boolean;
  closeButton: ReactNode;
}) {
  const { data: zones = [] } = useZones();
  const { data: cameras, isPending: camerasPending } = useCameras();
  const zone = zones.find((z) => z.id === incident.zoneId);
  const zoneCameras = (cameras ?? []).filter((c) => c.zoneId === incident.zoneId).slice(0, 2);
  const reporter = incident.source === 'simulator' ? 'system' : 'user';
  // A type this console does not know has no category to show (ADR-0021, rolling deploys).
  const category = categoryOfType(incident.type);

  return (
    <>
      <div className={styles.head}>
        <TopRow code={incident.code} closeButton={closeButton} />
        <div className={styles.badges}>
          <SeverityBadge severity={incident.severity} />
          <span className={styles.chip}>
            <Icon glyph={incidentTypeIcon(incident.type)} size={16} className={styles.chipIcon} />
            {typeLabel(incident.type)}
          </span>
          {category !== null && (
            <span className={styles.chip}>
              <Icon glyph={categoryIcon(category)} size={16} className={styles.chipIcon} />
              {categoryLabel(category)}
            </span>
          )}
          {zone && (
            <span className={styles.chip}>
              <Icon glyph={zoneKindIcon(zone.kind)} size={16} className={styles.chipIcon} />
              {zone.name}
            </span>
          )}
        </div>
        <h2 className={styles.title}>{incident.title}</h2>
        <IncidentLifecycle incident={incident} />
      </div>

      <div className={styles.section}>
        {incident.description && <p className={styles.description}>{incident.description}</p>}
        <dl className={styles.facts}>
          <dt>Reported by</dt>
          <dd>
            <Icon glyph={actorKindIcon(reporter)} size={14} />
            {reporter === 'system' ? 'Sensor (simulated)' : 'Operator'}
          </dd>
        </dl>
      </div>

      <section className={styles.section}>
        <h3>Timeline</h3>
        <IncidentTimeline timeline={incident.timeline} />
      </section>

      <section className={styles.section}>
        <h3>Cameras in {zone?.name ?? 'this zone'}</h3>
        {camerasPending ? (
          <div className={styles.cameras} aria-busy="true">
            <p role="status" className={styles.hidden}>
              Loading cameras…
            </p>
            <Skeleton className={styles.skeletonCamera} />
            <Skeleton className={styles.skeletonCamera} />
          </div>
        ) : !cameras ? (
          // The camera strip offers the Retry for this same query; the sheet only says why it is empty.
          <p className={`${text.muted} ${styles.noCameras}`}>Cameras could not be loaded.</p>
        ) : zoneCameras.length === 0 ? (
          <p className={`${text.muted} ${styles.noCameras}`}>No cameras cover this zone.</p>
        ) : (
          <div className={styles.cameras}>
            {zoneCameras.map((camera) => (
              <CameraTile key={camera.id} camera={camera} variant="compact" />
            ))}
          </div>
        )}
      </section>

      {/* Last drawn content of the sheet: the footer sticks to its bottom. */}
      <IncidentResponse incident={incident} kept={kept} />
    </>
  );
}
