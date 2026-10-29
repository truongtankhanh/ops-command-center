import type { AssetDetail } from '@occ/contracts';
import { type ReactNode, useCallback, useMemo } from 'react';
import { ApiRequestError, isRateLimited } from '../../api/client';
import { useAsset, useIncidents, useModelParts, useZones } from '../../api/queries';
import {
  footprintText,
  incidentsOf,
  inspectorRows,
  inspectorStateText,
  readingIsStale,
} from '../../lib/assets/assetInspector';
import { assetStates, openIncidentOf, placeLabel } from '../../lib/assets/assets';
import { severityLabel } from '../../lib/incidents/incidents';
import { partRows } from '../../lib/twin-core/modelParts';
import { staleAfterMs } from '../../lib/telemetry/telemetryFreshness';
import { useAssetState, useServerNow } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Hint } from '../../ui/Hint';
import { Icon } from '../../ui/Icon';
import { assetStateIcon, Box, severityIcon, zoneKindIcon } from '../../ui/icons';
import { InspectorFrame } from '../../ui/InspectorFrame';
import { SheetSection } from '../../ui/SheetSection';
import { Skeleton } from '../../ui/Skeleton';
import { AssetFoot } from './AssetFoot';
import { AssetIncidents } from './AssetIncidents';
import styles from './AssetInspector.module.css';
import { AssetParts, AssetPartsSkeleton } from './AssetParts';
import { AssetReadings } from './AssetReadings';
import { LoadFailed, RateLimited } from '../shell/LoadStates';

/**
 * One asset in the sheet (frames 03, 05, 08): its head and badges, then its live readings. One
 * `InspectorFrame` (so one `Sheet`) holds the loading, failed and loaded states, with the head, the
 * body and the foot as its slots, so data arriving never moves focus (`IncidentDetail` does the
 * same). The body is the frame's only tab for now, so no tab list is drawn (V3-09.8 adds the
 * others).
 *
 * The catalogue half (`useAsset`: points and rules) is reference data; the readings are telemetry,
 * read per asset from the telemetry store, so this re-renders with the server clock and with this
 * asset's own readings, and not for another asset's. Closing clears only the asset selection: the
 * watch set follows it (`App`).
 *
 * **Escape is a step of the scene's ladder, the Close button is not (V2-15.11, ADR-0020 "Settled in V2-15.1").**
 * With focus in the sheet Escape first closes the part's callout (`selectPart(null)`: the asset and this sheet stay)
 * and only then the asset. Close ends the inspector in one press, the part with it. `Sheet` calls its `onClose` for
 * Escape alone (the frame's `onEscape`), which is why the two can differ without a change to the shared primitive.
 */
export function AssetInspector({ code }: { code: string }) {
  const { data: detail, error, failureReason, isPending, isFetching, refetch } = useAsset(code);
  const selectAsset = useConsole((s) => s.selectAsset);
  const close = useCallback(() => selectAsset(null), [selectAsset]);
  // Read at the press, not at render: the part may have been selected in the scene since this rendered.
  const escape = useCallback(() => {
    const { selectedPart, selectPart } = useConsole.getState();
    if (selectedPart !== null) selectPart(null);
    else selectAsset(null);
  }, [selectAsset]);

  const closeButton = (
    <Button variant="ghost" size="sm" shortcut="Esc" onClick={close} aria-label="Close asset">
      Close
    </Button>
  );

  const loading = !detail && isPending && !isRateLimited(failureReason);

  return (
    <InspectorFrame
      label={`Asset ${code}`}
      onEscape={escape}
      // Data first: a failed background refetch keeps the asset on screen.
      header={
        detail ? (
          <AssetHead detail={detail} closeButton={closeButton} />
        ) : loading ? (
          <InspectorSkeleton code={code} closeButton={closeButton} />
        ) : (
          <div className={styles.head}>
            <TopRow code={code} closeButton={closeButton} />
          </div>
        )
      }
      tabsLabel="Asset sections"
      tabs={[
        {
          value: 'details',
          label: 'Details',
          content: detail ? (
            <AssetContent detail={detail} />
          ) : loading ? null : isPending ? (
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
          ),
        },
      ]}
      foot={detail ? <AssetFoot asset={detail} /> : undefined}
    />
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

/** The head of the sheet: code and Close, the name, the state pill and the badges. */
function AssetHead({ detail, closeButton }: { detail: AssetDetail; closeButton: ReactNode }) {
  const { data: zones } = useZones();
  const { data: incidents } = useIncidents();
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();

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
  const unmodelled = detail.class.modelUrl === null;

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
  );
}

/** What the sheet's only tab holds: the readings, the parts, the incident and the twin note. */
function AssetContent({ detail }: { detail: AssetDetail }) {
  const { data: incidents } = useIncidents();
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();

  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
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

  return (
    <>
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
