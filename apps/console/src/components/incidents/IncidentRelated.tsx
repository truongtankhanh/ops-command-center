import type { Asset } from '@occ/contracts';
import { useZones } from '../../api/queries';
import { assetLinkLines } from '../../lib/assets/assetLink';
import type { RelatedOfIncident } from '../../lib/assets/relatedItems';
import type { RelatedState } from '../../lib/incidents/useRelatedOfIncident';
import { useNow } from '../../lib/shared/useNow';
import { buildingFocusOf } from '../../lib/twin-core/twinLevel';
import { useConsole } from '../../store';
import text from '../../styles/text.module.css';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { assetClassIcon } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import { CameraTile } from '../cameras/CameraTile';
import styles from './IncidentRelated.module.css';
import { IncidentRow } from './IncidentRow';

/**
 * The incident sheet's Related tab (V3-09.5; frame 03a): what else is around this incident, from
 * `relatedOfIncident` through `useRelatedOfIncident`, so the badge on the tab and these rows are
 * one source. In this order, each section only when it has items: the other unresolved incidents
 * in the zone, the device that raised it (a telemetry incident), and the cameras that cover it.
 *
 * The tab is read-only for every role: opening an incident or the device is not an action on the
 * site, so nothing here checks a permission. Choosing an incident selects it, and the sheet is
 * replaced by that incident's (`App` keys the sheet by id, so it opens on Details). "Open asset"
 * replaces it with the asset inspector, whose "Incident raised by this asset" row is the way back.
 *
 * Two things the tab will not say by guess: while a list is on its way it is a skeleton, and a list
 * that could not be loaded says so. "Nothing else is related" is drawn only for lists that arrived
 * and held nothing.
 */
export function IncidentRelated({ state }: { state: RelatedState }) {
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
function RelatedLists({ related }: { related: RelatedOfIncident }) {
  const now = useNow();

  if (related.count === 0) {
    return (
      <div className={styles.section}>
        <EmptyState>Nothing else is related to this incident.</EmptyState>
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
              // Every row is in the one zone the sheet's incident is in: the zone is not repeated.
              <li key={incident.id}>
                <IncidentRow incident={incident} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.device && (
        <section className={styles.section}>
          <h3>Device</h3>
          <DeviceRow asset={related.device} />
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
    </>
  );
}

/**
 * The device as a row with the way to its inspector, the evidence's asset link in small (V2-11.3):
 * the same words (`assetLinkLines`, without a part: the evidence knows which part the rule watches,
 * this tab does not) and the same step. "Show in 3D" stays with the evidence. The button's name
 * puts the visible words first (WCAG 2.5.3).
 */
function DeviceRow({ asset }: { asset: Asset }) {
  const { data: zones } = useZones();
  const selectAsset = useConsole((s) => s.selectAsset);
  const zone = zones?.find((candidate) => candidate.id === asset.zoneId);
  const { heading, detail } = assetLinkLines(asset, zone);

  return (
    <div className={styles.device}>
      <span className={styles.deviceTile} aria-hidden="true">
        <Icon glyph={assetClassIcon(asset.class.code)} size={20} />
      </span>
      <span className={styles.deviceText}>
        <b className={styles.deviceName}>{heading}</b>
        {detail !== null && <small className={styles.deviceDetail}>{detail}</small>}
      </span>
      <Button
        size="sm"
        aria-label={`Open asset ${asset.code}`}
        onClick={() => selectAsset(asset.code, buildingFocusOf(asset, zones))}
      >
        Open asset
      </Button>
    </div>
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
