import type { AssetDetail } from '@occ/contracts';
import { type ReactNode, useCallback, useMemo } from 'react';
import { ApiRequestError, isRateLimited } from '../api/client';
import { useAsset, useIncidents, useModelParts, useZones } from '../api/queries';
import {
  footprintText,
  incidentsOf,
  inspectorRows,
  inspectorStateText,
  readingIsStale,
} from '../lib/assetInspector';
import { assetStates, openIncidentOf, placeLabel } from '../lib/assets';
import { severityLabel } from '../lib/incidents';
import { partRows } from '../lib/modelParts';
import { staleAfterMs } from '../lib/telemetryFreshness';
import { useAssetState, useServerNow } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Hint } from '../ui/Hint';
import { Icon } from '../ui/Icon';
import { assetStateIcon, Box, severityIcon, zoneKindIcon } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { SheetSection } from '../ui/SheetSection';
import { Skeleton } from '../ui/Skeleton';
import { AssetFoot } from './AssetFoot';
import { AssetIncidents } from './AssetIncidents';
import styles from './AssetInspector.module.css';
import { AssetParts, AssetPartsSkeleton } from './AssetParts';
import { AssetReadings } from './AssetReadings';
import { LoadFailed, RateLimited } from './LoadStates';

/**
 * One asset in the sheet (frames 03, 05, 08): its head and badges, then its live readings. One
 * `Sheet` holds the loading, failed and loaded states, so data arriving never moves focus
 * (`IncidentDetail` does the same).
 *
 * The catalogue half (`useAsset`: points and rules) is reference data; the readings are telemetry,
 * read per asset from the telemetry store, so this re-renders with the server clock and with this
 * asset's own readings, and not for another asset's. Closing clears only the asset selection: the
 * watch set follows it (`App`).
 */
export function AssetInspector({ code }: { code: string }) {
  const { data: detail, error, failureReason, isPending, isFetching, refetch } = useAsset(code);
  const selectAsset = useConsole((s) => s.selectAsset);
  const close = useCallback(() => selectAsset(null), [selectAsset]);

  const closeButton = (
    <Button variant="ghost" size="sm" shortcut="Esc" onClick={close} aria-label="Close asset">
      Close
    </Button>
  );

  return (
    <Sheet label={`Asset ${code}`} onClose={close}>
      {/* Data first: a failed background refetch keeps the asset on screen. */}
      {detail ? (
        <InspectorBody detail={detail} closeButton={closeButton} />
      ) : isPending && !isRateLimited(failureReason) ? (
        <InspectorSkeleton code={code} closeButton={closeButton} />
      ) : (
        <>
          <div className={styles.head}>
            <TopRow code={code} closeButton={closeButton} />
          </div>
          {isPending ? (
            <RateLimited />
          ) : error instanceof ApiRequestError && error.status === 404 ? (
            <EmptyState>This asset no longer exists.</EmptyState>
          ) : (
            <LoadFailed
              error={error}
              fallback="This asset could not be loaded."
              isFetching={isFetching}
              onRetry={() => void refetch()}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

function TopRow({ code, closeButton }: { code: ReactNode; closeButton: ReactNode }) {
  return (
    <div className={styles.toprow}>
      <span className={styles.code}>{code}</span>
      {closeButton}
    </div>
  );
}

/** Laid out like the loaded head and the first rows, so nothing jumps when the asset arrives. */
function InspectorSkeleton({ code, closeButton }: { code: string; closeButton: ReactNode }) {
  return (
    <div aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading asset…
      </p>
      <div className={styles.head}>
        <TopRow code={code} closeButton={closeButton} />
        <Skeleton className={styles.skeletonTitle} />
        <div className={styles.badges}>
          <Skeleton className={styles.skeletonBadge} />
          <Skeleton className={styles.skeletonBadge} />
          <Skeleton className={styles.skeletonBadge} />
        </div>
      </div>
      <div className={styles.skeletonRows}>
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className={styles.skeletonRow} />
        ))}
      </div>
    </div>
  );
}

function InspectorBody({ detail, closeButton }: { detail: AssetDetail; closeButton: ReactNode }) {
  const { data: zones } = useZones();
  const { data: incidents } = useIncidents();
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();

  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
  // The list's own rule for one asset, so the pill and the Assets tab never disagree.
  const state = useMemo(
    () =>
      assetStates(
        [detail],
        incidents ?? [],
        entry === undefined ? {} : { [detail.code]: entry },
        serverNow,
      ).get(detail.code) ?? 'unknown',
    [detail, incidents, entry, serverNow],
  );
  const incident = incidents === undefined ? undefined : openIncidentOf(detail, incidents);
  const rows = useMemo(() => inspectorRows(detail.points, detail.rules), [detail]);
  // The parts are the model's (V2-14.10): its node tree is read once per model file and shared by every asset
  // of the class. While it is on its way the section is a skeleton; if it cannot be read (the file is missing,
  // or has no named part) there is no section and the inspector still works. "No 3D model" is for a class with
  // no `modelUrl` only, never for a model that failed to load.
  const model = useModelParts(detail.class.modelUrl);
  const parts = useMemo(
    () => (model.data ? partRows(model.data, detail.points) : []),
    [model.data, detail.points],
  );
  const unmodelled = detail.class.modelUrl === null;
  const raised = useMemo(
    () => (incidents === undefined ? [] : incidentsOf(detail, incidents)),
    [detail, incidents],
  );

  const pillText = inspectorStateText(state, entry?.receivedAt ?? null, serverNow);
  // A fault keeps its incident's severity glyph; `unknown` has no word and so no glyph.
  const pillGlyph =
    state === 'fault'
      ? incident && severityIcon(incident.severity)
      : state === 'unknown'
        ? undefined
        : assetStateIcon(state);
  const zone = zones?.find((z) => z.id === detail.zoneId);
  const place = placeLabel(detail, zone);

  return (
    <>
      <div className={styles.head}>
        <TopRow code={`${detail.code} · ${detail.class.name}`} closeButton={closeButton} />
        <h2 className={styles.title}>{detail.name}</h2>
        <div className={styles.badges}>
          {pillText !== null && (
            <span
              className={styles.pill}
              data-state={state}
              data-severity={state === 'fault' ? incident?.severity : undefined}
            >
              {pillGlyph && <Icon glyph={pillGlyph} size={14} />}
              {state === 'fault' && incident && (
                <span className={styles.hidden}>{severityLabel(incident.severity)} severity, </span>
              )}
              {pillText}
            </span>
          )}
          {zone && place !== null && (
            <span className={styles.chip}>
              <Icon glyph={zoneKindIcon(zone.kind)} size={16} className={styles.chipIcon} />
              {place}
            </span>
          )}
          {/* Not said while the incident list is still loading: "none" would be a guess. */}
          {incidents !== undefined && (
            <span className={styles.chip}>
              {incident ? `Fault · ${incident.code}` : 'No open incidents'}
            </span>
          )}
          {unmodelled && (
            <span className={styles.chip}>
              <Icon glyph={Box} size={16} className={styles.chipIcon} />
              No 3D model
            </span>
          )}
        </div>
      </div>
      <AssetReadings
        assetCode={detail.code}
        rows={rows}
        entry={entry}
        serverNow={serverNow}
        stale={stale}
      />
      {model.isLoading ? (
        <AssetPartsSkeleton />
      ) : (
        parts.length > 0 && (
          <AssetParts
            assetCode={detail.code}
            parts={parts}
            points={detail.points}
            entry={entry}
            stale={stale}
          />
        )
      )}
      {/* Not drawn while the incident list loads, as the head's badge: "none" would be a guess. */}
      {raised.length > 0 && <AssetIncidents incidents={raised} />}
      {unmodelled && (
        <SheetSection title="In the twin">
          <Hint>{noModelNote(detail.class.footprintM)}</Hint>
        </SheetSection>
      )}
      <AssetFoot asset={detail} />
    </>
  );
}

/** Frame 15's note, with the class's box in place of the frame's one cube. */
function noModelNote(footprint: AssetDetail['class']['footprintM']): string {
  return (
    `This asset class has no model yet, so it is drawn as a ${footprintText(footprint)} neutral ` +
    'box at its position. Its readings, states and incident work exactly as for modelled assets.'
  );
}
