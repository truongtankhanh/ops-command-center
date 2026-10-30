import type { AssetDetail, Incident } from '@occ/contracts';
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
import { type AssetState, assetStates, openIncidentOf, placeLabel } from '../../lib/assets/assets';
import { type DeviceInfoRow, deviceInfoRows } from '../../lib/assets/deviceInfo';
import { severityLabel } from '../../lib/incidents/incidents';
import { partRows } from '../../lib/twin-core/modelParts';
import { staleAfterMs } from '../../lib/telemetry/telemetryFreshness';
import type { AssetTelemetryState } from '../../lib/telemetry/telemetryState';
import { useAssetState, useServerNow } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Hint } from '../../ui/Hint';
import { Icon } from '../../ui/Icon';
import { assetClassIcon, assetStateIcon, Box, severityIcon, zoneKindIcon } from '../../ui/icons';
import { InspectorFrame } from '../../ui/InspectorFrame';
import { InspectorHeader } from '../../ui/InspectorHeader';
import { SheetSection } from '../../ui/SheetSection';
import { Skeleton } from '../../ui/Skeleton';
import { AssetFoot } from './AssetFoot';
import { AssetIncidents } from './AssetIncidents';
import styles from './AssetInspector.module.css';
import { AssetParts, AssetPartsSkeleton } from './AssetParts';
import { AssetReadings } from './AssetReadings';
import { DeviceCard } from './DeviceCard';
import { LiveTiles } from './LiveTiles';
import { LoadFailed, RateLimited } from '../shell/LoadStates';

/**
 * One asset in the sheet (frames 03, 04, 05, 08): its header, then its live readings. One
 * `InspectorFrame` (so one `Sheet`) holds the loading, failed and loaded states, with the header,
 * the body and the foot as its slots, so data arriving never moves focus (`IncidentDetail` does the
 * same). The header is the shared `InspectorHeader` (V3-09.7): the class's icon, the name, the code
 * and class, Close, and the chips (state, place, incident, "No 3D model"). The body is the frame's
 * only tab for now, so no tab list is drawn (V3-09.8 adds the others).
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
          <HeaderSkeleton code={code} closeButton={closeButton} />
        ) : (
          <InspectorHeader subtitle={code} closeButton={closeButton} />
        )
      }
      tabsLabel="Asset sections"
      tabs={[
        {
          value: 'details',
          label: 'Details',
          content: detail ? (
            <AssetContent detail={detail} />
          ) : loading ? (
            <BodySkeleton />
          ) : isPending ? (
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

/** The header laid out like the loaded one (the body's skeleton is `BodySkeleton`). */
function HeaderSkeleton({ code, closeButton }: { code: string; closeButton: ReactNode }) {
  return (
    <InspectorHeader subtitle={code} closeButton={closeButton}>
      {/* The first block of the chip row takes most of it, so the chips wrap under it. */}
      <Skeleton className={styles.skeletonTitle} />
      <Skeleton className={styles.skeletonBadge} />
      <Skeleton className={styles.skeletonBadge} />
      <Skeleton className={styles.skeletonBadge} />
    </InspectorHeader>
  );
}

/**
 * Laid out like the first rows, so nothing jumps when the asset arrives. It announces the loading
 * once for the whole sheet (the header's blocks are decorative).
 */
function BodySkeleton() {
  return (
    <div className={styles.skeletonRows} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading asset…
      </p>
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className={styles.skeletonRow} />
      ))}
    </div>
  );
}

/**
 * The list's own rule for one asset, so the pill, the card and the Assets tab never disagree. It
 * changes with the clock, so a caller that renders every second memoizes on its inputs.
 */
function inspectedState(
  detail: AssetDetail,
  incidents: readonly Incident[] | undefined,
  entry: AssetTelemetryState | undefined,
  serverNow: number | null,
): AssetState {
  return (
    assetStates(
      [detail],
      incidents ?? [],
      entry === undefined ? {} : { [detail.code]: entry },
      serverNow,
    ).get(detail.code) ?? 'unknown'
  );
}

/**
 * The header of the sheet (frame 04): the class's icon in a tile (the open incident's hue for a
 * fault), the name, the code and class, Close, then the chips: the state pill, the place, the
 * incident and "No 3D model". The state and the incident are words as well as glyphs, so the tile
 * is decorative.
 */
function AssetHead({ detail, closeButton }: { detail: AssetDetail; closeButton: ReactNode }) {
  const { data: zones } = useZones();
  const { data: incidents } = useIncidents();
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();

  const state = useMemo(
    () => inspectedState(detail, incidents, entry, serverNow),
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
    <InspectorHeader
      tile={<Icon glyph={assetClassIcon(detail.class.code)} size={22} />}
      severity={state === 'fault' ? incident?.severity : undefined}
      title={detail.name}
      subtitle={`${detail.code} · ${detail.class.name}`}
      closeButton={closeButton}
    >
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
    </InspectorHeader>
  );
}

/**
 * The card rows the header already says: the name is its `h2` and the status is its pill, so the
 * card states what the header does not (frame 04a: device ID, class, location, and the battery
 * for a class that has the point). The incident sheet keeps all the rows (V3-09.4).
 */
const SAID_BY_THE_HEADER: ReadonlySet<DeviceInfoRow['id']> = new Set(['name', 'status']);

/**
 * What the sheet's only tab holds (V3-09.7; frame 04): the device card and the live tiles, then the
 * readings, the parts, the incident and the twin note. The full list of points (`AssetReadings`)
 * moves to the Telemetry tab in V3-09.8; until then the headline and ruled points are drawn twice,
 * as tiles and as rows.
 */
function AssetContent({ detail }: { detail: AssetDetail }) {
  const { data: zones } = useZones();
  const { data: incidents } = useIncidents();
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();

  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
  const rows = useMemo(() => inspectorRows(detail.points, detail.rules), [detail]);
  const zone = zones?.find((candidate) => candidate.id === detail.zoneId);
  const state = useMemo(
    () => inspectedState(detail, incidents, entry, serverNow),
    [detail, incidents, entry, serverNow],
  );
  const info = useMemo(
    () =>
      deviceInfoRows(detail, zone, state, entry).filter((row) => !SAID_BY_THE_HEADER.has(row.id)),
    [detail, zone, state, entry],
  );
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
      <DeviceCard rows={info} />
      {/* `rows.main` is memoised: each tile gets the same `row` object and skips other renders. */}
      <LiveTiles
        assetCode={detail.code}
        rows={rows.main}
        entry={entry}
        serverNow={serverNow}
        stale={stale}
      />
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
