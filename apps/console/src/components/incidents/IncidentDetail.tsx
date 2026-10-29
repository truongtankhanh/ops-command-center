import type { Camera, IncidentDetail as Detail } from '@occ/contracts';
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ApiRequestError, isRateLimited } from '../../api/client';
import { useAssets, useCameras, useIncident, useZones } from '../../api/queries';
import { incidentCameras } from '../../lib/cameras/cameras';
import { categoryLabel, categoryOfType, typeLabel } from '../../lib/incidents/incidents';
import { useConsole } from '../../store';
import text from '../../styles/text.module.css';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { focusLost } from '../../ui/focus';
import { Icon } from '../../ui/Icon';
import { actorKindIcon, categoryIcon, incidentTypeIcon, zoneKindIcon } from '../../ui/icons';
import { InspectorFrame } from '../../ui/InspectorFrame';
import { SeverityBadge } from '../../ui/SeverityBadge';
import { Skeleton } from '../../ui/Skeleton';
import { CameraTile } from '../cameras/CameraTile';
import styles from './IncidentDetail.module.css';
import { IncidentEvidence } from './IncidentEvidence';
import { IncidentLifecycle } from './IncidentLifecycle';
import { IncidentResponse, NOTE_KEPT } from './IncidentResponse';
import { IncidentTimeline } from './IncidentTimeline';
import { LoadFailed, RateLimited } from '../shell/LoadStates';

/**
 * The incident in the sheet (frames 02 / 06). One `InspectorFrame` (so one `Sheet`) holds the
 * loading, failed and loaded states, with the head, the body and the footer as its slots, so the
 * data arriving never moves focus. The body is the frame's only tab for now, so no tab list is
 * drawn (V3-09.4 adds the others). The note being written lives in the store (`noteDrafts`):
 * leaving for another incident or the report form keeps it, and only Close or a sent note clears
 * it.
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

  const loading = !incident && isPending && !isRateLimited(failureReason);

  return (
    <InspectorFrame
      ref={sheetRef}
      label={incident ? `Incident ${incident.code}` : 'Incident'}
      onEscape={close}
      keepOpen={hasDraft}
      keptMessage={NOTE_KEPT}
      onEscapeKept={keepNote}
      // Data first: a failed background refetch keeps the incident on screen (TanStack keeps it).
      header={
        incident ? (
          <DetailHead incident={incident} closeButton={closeButton} />
        ) : loading ? (
          <DetailSkeleton closeButton={closeButton} />
        ) : (
          <div className={styles.head}>
            <TopRow closeButton={closeButton} />
          </div>
        )
      }
      tabsLabel="Incident sections"
      tabs={[
        {
          value: 'details',
          label: 'Details',
          content: incident ? (
            <DetailContent incident={incident} />
          ) : loading ? null : isPending ? (
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
          ),
        },
      ]}
      // Last drawn content of the sheet: the footer sticks to its bottom.
      foot={incident ? <IncidentResponse incident={incident} kept={kept} /> : undefined}
    />
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

/**
 * The "Reported by" text. A telemetry rule is not a sensor the demo simulates, so it has its own
 * word (ADR-0018). A source this console does not know yet reads as a person, which is also what
 * an older console shows for `telemetry` during a rolling deploy.
 */
function reporterLabel(source: Detail['source']): string {
  if (source === 'telemetry') return 'System';
  if (source === 'simulator') return 'Sensor (simulated)';
  return 'Operator';
}

/** The head of the sheet: code and Close, the badges, the title and the lifecycle. */
function DetailHead({ incident, closeButton }: { incident: Detail; closeButton: ReactNode }) {
  const { data: zones = [] } = useZones();
  const zone = zones.find((z) => z.id === incident.zoneId);
  // A type this console does not know has no category to show (ADR-0021, rolling deploys).
  const category = categoryOfType(incident.type);

  return (
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
        {incident.source === 'telemetry' && (
          <span className={styles.chip}>
            <Icon glyph={actorKindIcon('system')} size={16} className={styles.chipIcon} />
            Telemetry rule
          </span>
        )}
      </div>
      <h2 className={styles.title}>{incident.title}</h2>
      <IncidentLifecycle incident={incident} />
    </div>
  );
}

/** What the sheet's only tab holds: the description, the evidence, the timeline and the cameras. */
function DetailContent({ incident }: { incident: Detail }) {
  const { data: zones = [] } = useZones();
  const zone = zones.find((z) => z.id === incident.zoneId);
  const reporter =
    incident.source === 'simulator' || incident.source === 'telemetry' ? 'system' : 'user';

  return (
    <>
      <div className={styles.section}>
        {incident.description && <p className={styles.description}>{incident.description}</p>}
        <dl className={styles.facts}>
          <dt>Reported by</dt>
          <dd>
            <Icon glyph={actorKindIcon(reporter)} size={14} />
            {reporterLabel(incident.source)}
          </dd>
        </dl>
      </div>

      {/* Frame 10: the evidence comes before the history. Only a telemetry rule leaves evidence. */}
      {incident.source === 'telemetry' && <IncidentEvidence incident={incident} />}

      <section className={styles.section}>
        <h3>Timeline</h3>
        <IncidentTimeline timeline={incident.timeline} />
      </section>

      {/* Only a telemetry incident has an asset to look at: the others add no query (V2-11.3). */}
      {incident.source === 'telemetry' && incident.assetId ? (
        <AssetCameras incident={incident} zoneName={zone?.name} />
      ) : (
        <ZoneCameras incident={incident} zoneName={zone?.name} />
      )}
    </>
  );
}

/** The cameras of the incident's zone: what the sheet has always shown. */
function ZoneCameras({ incident, zoneName }: { incident: Detail; zoneName: string | undefined }) {
  const { data: cameras, isPending } = useCameras();
  return (
    <CameraSection
      title={`Cameras in ${zoneName ?? 'this zone'}`}
      cameras={cameras && incidentCameras(cameras, incident, undefined).cameras}
      pending={isPending}
    />
  );
}

/**
 * The cameras of a telemetry incident (frame 10, V2-11.3): those that see its asset first, then its
 * zone's, titled "Cameras on CT-01" only when a camera shown sees it, else as the zone's. Its own
 * component because it needs the catalogue, which an operator's incident never asks for. While the
 * catalogue loads the section is its skeleton; a catalogue that failed, or that lacks the asset,
 * leaves the zone's cameras.
 */
function AssetCameras({ incident, zoneName }: { incident: Detail; zoneName: string | undefined }) {
  const { data: cameras, isPending: camerasPending } = useCameras();
  const { data: assets, isPending: cataloguePending } = useAssets();
  const asset = assets?.find((candidate) => candidate.id === incident.assetId);
  const picked = cameras && incidentCameras(cameras, incident, asset);
  const title =
    picked?.onAsset && asset ? `Cameras on ${asset.code}` : `Cameras in ${zoneName ?? 'this zone'}`;
  return (
    <CameraSection
      title={title}
      cameras={picked?.cameras}
      pending={camerasPending || cataloguePending}
    />
  );
}

/** `cameras` is `undefined` when the list could not be loaded. */
function CameraSection({
  title,
  cameras,
  pending,
}: {
  title: string;
  cameras: Camera[] | undefined;
  pending: boolean;
}) {
  return (
    <section className={styles.section}>
      <h3>{title}</h3>
      {pending ? (
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
      ) : cameras.length === 0 ? (
        <p className={`${text.muted} ${styles.noCameras}`}>No cameras cover this zone.</p>
      ) : (
        <div className={styles.cameras}>
          {cameras.map((camera) => (
            <CameraTile key={camera.id} camera={camera} variant="compact" />
          ))}
        </div>
      )}
    </section>
  );
}
