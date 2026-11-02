import type { Asset, Incident } from '@occ/contracts';
import { useMemo } from 'react';
import { useIncidents, useZones } from '../../api/queries';
import { inspectorStateText } from '../../lib/assets/assetInspector';
import { assetStateOf, openIncidentOf } from '../../lib/assets/assets';
import type { RelatedOfAsset } from '../../lib/assets/relatedItems';
import type { AssetRelatedState } from '../../lib/assets/useRelatedOfAsset';
import { severityLabel } from '../../lib/incidents/incidents';
import { useNow } from '../../lib/shared/useNow';
import { buildingFocusOf } from '../../lib/twin-core/twinLevel';
import { useAssetState, useServerNow } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import text from '../../styles/text.module.css';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { assetClassIcon, assetStateIcon, severityIcon } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import { CameraTile } from '../cameras/CameraTile';
import { IncidentRow } from '../incidents/IncidentRow';
import styles from './AssetRelated.module.css';

/**
 * The asset sheet's Related tab (V3-09.8): what else is around this asset, from `relatedOfAsset`
 * through `useRelatedOfAsset`, so the badge on the tab and these rows are one source. In this
 * order, each section only when it has items: the asset's own unresolved incidents, the cameras
 * that see it, and the other assets in its zone. It is the counterpart of the incident sheet's
 * `IncidentRelated` and keeps its two refusals: while a list is on its way the tab is a skeleton
 * (no 0 from a guess), and a list that could not be loaded says so (no "nothing is related" from
 * a failure). "Nothing else is related" is drawn only for lists that arrived and held nothing.
 *
 * The tab is read-only for every role: opening an incident or an asset is not an action on the
 * site, so nothing here checks a permission. Choosing an incident selects it and choosing an asset
 * selects that one; either replaces the sheet (`App` keys both by what is selected, so the new one
 * opens on Details) and `Sheet` hands focus to it when the pressed row went away with the old one.
 * The Details tab's own "Incident raised by this asset" section is the same incident by another
 * way in; the two are never on screen together (one tab at a time).
 */
export function AssetRelated({ state }: { state: AssetRelatedState }) {
  if (state.status === 'loading') return <RelatedSkeleton />;
  if (state.status === 'failed') {
    return (
      <div className={styles.section}>
        <p className={text.muted}>Related items could not be loaded.</p>
      </div>
    );
  }
  return <RelatedLists related={state.related} />;
}

/** Its own component so the clock ticks only for a tab that has rows to age. */
function RelatedLists({ related }: { related: RelatedOfAsset }) {
  const now = useNow();
  const { data: zones } = useZones();
  // Read once and handed to every sibling, so a row reads no list of its own.
  const { data: incidents } = useIncidents();

  if (related.count === 0) {
    return (
      <div className={styles.section}>
        <EmptyState>Nothing else is related to this asset.</EmptyState>
      </div>
    );
  }

  return (
    <>
      {related.incidents.length > 0 && (
        <section className={styles.section}>
          <h3>{`Incidents · ${related.incidents.length}`}</h3>
          <ul className={styles.rows}>
            {related.incidents.map((incident) => (
              // Every row is this asset's: the zone is not repeated.
              <li key={incident.id}>
                <IncidentRow incident={incident} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.cameras.length > 0 && (
        <section className={styles.section}>
          <h3>{`Cameras covering it · ${related.cameras.length}`}</h3>
          <div className={styles.cameras}>
            {related.cameras.map((camera) => (
              <CameraTile key={camera.id} camera={camera} variant="compact" />
            ))}
          </div>
        </section>
      )}

      {related.assets.length > 0 && (
        <section className={styles.section}>
          <h3>{`Assets in this zone · ${related.assets.length}`}</h3>
          <ul className={styles.rows}>
            {related.assets.map((asset) => (
              <li key={asset.id}>
                <SiblingRow
                  asset={asset}
                  incidents={incidents}
                  focusZoneId={buildingFocusOf(asset, zones)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * Another asset of the zone: its class glyph, name, the state word and its code, and one press to
 * open it (the focus of its building as in the Assets list). It is not `AssetRow`: that row is the
 * list's own (a roving tab stop, a second press deselects) and a sibling is never the selected one.
 * The state is the list's rule (`assetStateOf`) over this asset's own reading and the clock, and
 * the word is the header pill's (`inspectorStateText`), so a sibling reads as its own sheet will;
 * a fault keeps its incident's severity glyph and says the severity in one hidden text node (an
 * accessible name trims each element, so the word must not be split), `unknown` has no word.
 */
function SiblingRow({
  asset,
  incidents,
  focusZoneId,
}: {
  asset: Asset;
  incidents: readonly Incident[] | undefined;
  focusZoneId: string | null;
}) {
  const entry = useAssetState(asset.code);
  const serverNow = useServerNow();
  const selectAsset = useConsole((s) => s.selectAsset);

  const state = useMemo(
    () => assetStateOf(asset, incidents, entry, serverNow),
    [asset, incidents, entry, serverNow],
  );
  const incident =
    state === 'fault' && incidents !== undefined ? openIncidentOf(asset, incidents) : undefined;
  const word = inspectorStateText(state, entry?.receivedAt ?? null, serverNow);
  const glyph =
    state === 'fault'
      ? incident && severityIcon(incident.severity)
      : state === 'unknown'
        ? undefined
        : assetStateIcon(state);

  return (
    <button
      type="button"
      className={styles.sibling}
      data-state={state}
      data-severity={incident?.severity}
      onClick={() => selectAsset(asset.code, focusZoneId)}
    >
      <span className={styles.siblingTile}>
        <Icon glyph={assetClassIcon(asset.class.code)} size={20} />
      </span>
      <span className={styles.siblingName}>{asset.name}</span>
      {word !== null && (
        <span className={styles.state} data-state={state}>
          {glyph && <Icon glyph={glyph} size={14} />}
          {incident && (
            <span className={styles.hidden}>{severityLabel(incident.severity)} severity, </span>
          )}
          {word}
        </span>
      )}
      <span className={styles.siblingCode}>{asset.code}</span>
    </button>
  );
}

/** Two rows and two camera tiles, about what a zone with a neighbour looks like. */
function RelatedSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading related items…
      </p>
      <Skeleton className={styles.skeletonRow} />
      <Skeleton className={styles.skeletonRow} />
      <div className={styles.cameras}>
        <Skeleton className={styles.skeletonCamera} />
        <Skeleton className={styles.skeletonCamera} />
      </div>
    </div>
  );
}
