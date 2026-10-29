import type { Camera, IncidentDetail as Detail } from '@occ/contracts';
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ApiRequestError, isRateLimited } from '../../api/client';
import { useAssets, useCameras, useIncident, useZones } from '../../api/queries';
import { incidentCameras } from '../../lib/cameras/cameras';
import { categoryLabel, categoryOfType, formatAgo, typeLabel } from '../../lib/incidents/incidents';
import { useNow } from '../../lib/shared/useNow';
import { useConsole } from '../../store';
import text from '../../styles/text.module.css';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { focusLost } from '../../ui/focus';
import { Icon } from '../../ui/Icon';
import { actorKindIcon, categoryIcon, Clock, incidentTypeIcon } from '../../ui/icons';
import { InspectorFrame } from '../../ui/InspectorFrame';
import { InspectorHeader } from '../../ui/InspectorHeader';
import { SeverityBadge } from '../../ui/SeverityBadge';
import { Skeleton } from '../../ui/Skeleton';
import { StatusChip } from '../../ui/StatusChip';
import { CameraTile } from '../cameras/CameraTile';
import styles from './IncidentDetail.module.css';
import { IncidentDevice } from './IncidentDevice';
import { IncidentEvidence } from './IncidentEvidence';
import { IncidentLifecycle } from './IncidentLifecycle';
import { IncidentResponse, NOTE_KEPT } from './IncidentResponse';
import { IncidentTimeline } from './IncidentTimeline';
import { LoadFailed, RateLimited } from '../shell/LoadStates';

/**
 * The incident in the sheet (frames 02 / 06). One `InspectorFrame` (so one `Sheet`) holds the
 * loading, failed and loaded states, with the header, the body and the footer as its slots, so the
 * data arriving never moves focus. The header is the shared `InspectorHeader` (V3-09.4); the body
 * is the **Details** tab, the frame's only tab for now, so no tab list is drawn (Related and
 * Telemetry come with V3-09.5 and V3-09.6, and the Timeline moves out then). The note being
 * written lives in the store (`noteDrafts`): leaving for another incident or the report form keeps
 * it, and only Close or a sent note clears it.
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
          <InspectorHeader closeButton={closeButton} />
        )
      }
      tabsLabel="Incident sections"
      tabs={[
        {
          value: 'details',
          label: 'Details',
          content: incident ? (
            <DetailContent incident={incident} />
          ) : loading ? (
            <DetailBodySkeleton />
          ) : isPending ? (
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

/** The header laid out like the loaded one (the body's skeleton is `DetailBodySkeleton`). */
function DetailSkeleton({ closeButton }: { closeButton: ReactNode }) {
  return (
    <InspectorHeader
      subtitle={<Skeleton className={styles.skeletonCode} />}
      closeButton={closeButton}
    >
      <Skeleton className={styles.skeletonTitle} />
      {/* Severity, age, status and type: the common loaded row. */}
      <Skeleton className={styles.skeletonBadge} />
      <Skeleton className={styles.skeletonBadge} />
      <Skeleton className={styles.skeletonBadge} />
      <Skeleton className={styles.skeletonBadge} />
    </InspectorHeader>
  );
}

/**
 * Laid out like the lifecycle and the timeline, so nothing jumps when the incident arrives. It
 * announces the loading once for the whole sheet (the header's blocks are decorative).
 */
function DetailBodySkeleton() {
  return (
    <div className={styles.bodySkeleton} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading incident…
      </p>
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

/**
 * The header of the sheet (frame 02): the type's icon in a tile of the severity's hue, the title, the
 * code and the zone, Close, then the chips: severity, how long ago it was reported, the status (the
 * stepper in the body says the same in full), the type, the category and the source. The type and
 * the status are words as well as glyphs, so the tile is decorative.
 */
function DetailHead({ incident, closeButton }: { incident: Detail; closeButton: ReactNode }) {
  const { data: zones = [] } = useZones();
  const zone = zones.find((z) => z.id === incident.zoneId);
  // A type this console does not know has no category to show (ADR-0021, rolling deploys).
  const category = categoryOfType(incident.type);

  return (
    <InspectorHeader
      tile={<Icon glyph={incidentTypeIcon(incident.type)} size={22} />}
      severity={incident.severity}
      title={incident.title}
      subtitle={
        <>
          <span>{incident.code}</span>
          {zone && (
            <>
              <span aria-hidden="true">·</span>
              <span>{zone.name}</span>
            </>
          )}
        </>
      }
      closeButton={closeButton}
    >
      <SeverityBadge severity={incident.severity} />
      <IncidentAge reportedAt={incident.reportedAt} />
      <StatusChip status={incident.status} form="pill" />
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
      {incident.source === 'telemetry' && (
        <span className={styles.chip}>
          <Icon glyph={actorKindIcon('system')} size={16} className={styles.chipIcon} />
          Telemetry rule
        </span>
      )}
    </InspectorHeader>
  );
}

/**
 * How long ago the incident was reported. Its own component so the clock (`useNow`, every 15 s,
 * the stepper's cadence) renders this chip and not the header around it.
 */
function IncidentAge({ reportedAt }: { reportedAt: string }) {
  const now = useNow();
  return (
    <span className={styles.age}>
      <Icon glyph={Clock} size={14} />
      <span className={styles.hidden}>Reported </span>
      <time dateTime={reportedAt}>{formatAgo(reportedAt, now)}</time>
    </span>
  );
}

/**
 * What the Details tab holds, in the order of frame 02: the lifecycle, the description and who
 * reported it, the evidence and the device (a telemetry incident), the timeline (until it gets its
 * own tab, V3-09.5) and the cameras.
 */
function DetailContent({ incident }: { incident: Detail }) {
  const { data: zones = [] } = useZones();
  const zone = zones.find((z) => z.id === incident.zoneId);
  const reporter =
    incident.source === 'simulator' || incident.source === 'telemetry' ? 'system' : 'user';

  return (
    <>
      <div className={styles.section}>
        <IncidentLifecycle incident={incident} />
      </div>

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

      {/* The device the rule watched: only a telemetry incident has one (an operator's asks for no asset). */}
      {incident.source === 'telemetry' && incident.assetId && (
        <IncidentDevice incident={incident} />
      )}

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
