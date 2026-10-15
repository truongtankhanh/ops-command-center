import type { Zone } from '@occ/contracts';
import { useCallback, useMemo, useRef, useState } from 'react';
import { isRateLimited } from '../api/client';
import { useAssets, useIncidents, useZones } from '../api/queries';
import {
  ASSET_FILTERS,
  type AssetFilter,
  assetStates,
  countAssetFilters,
  matchesAssetQuery,
} from '../lib/assets';
import { searchTerms } from '../lib/incidents';
import { useShortcut } from '../lib/useShortcut';
import { useServerNow, useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { Tabs } from '../ui/Tabs';
import styles from './AssetFeed.module.css';
import { FeedSearch } from './FeedSearch';
import { LoadFailed, RateLimited } from './LoadStates';

/** As many placeholder rows as the incident feed's, enough to fill the column's first screen. */
const SKELETON_ROWS = 5;

const FILTER_LABELS: Record<AssetFilter, string> = {
  all: 'All',
  faults: 'Faults',
  nodata: 'No data',
};

/**
 * The Assets tab of the side panel (frames 02 and 03): the search, the three filter tabs with their
 * counts, and the loading / failed / empty states of the catalogue. The rows are V2-09.6's; until
 * then a catalogue that has assets draws nothing under the tabs, and not an empty list.
 *
 * Mounted while the Incidents panel shows (the panel is only `hidden`), so `/` is enabled only while
 * this panel is the visible one.
 */
export function AssetFeed() {
  const { data: assets, error, failureReason, isPending, isFetching, refetch } = useAssets();
  const { data: incidents } = useIncidents();
  const { data: zones = [] } = useZones();
  const overview = useTelemetryStore((s) => s.view.state.assets);
  const serverNow = useServerNow();
  const filter = useConsole((s) => s.assetFilter);
  const setFilter = useConsole((s) => s.setAssetFilter);
  const zoneId = useConsole((s) => s.assetZoneId);
  const visiblePanel = useConsole((s) => s.sidePanel === 'assets');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);
  useShortcut('/', focusSearch, visiblePanel);

  // Data first, as the incident feed: a failed background refetch keeps the list, so only a
  // catalogue that never arrived counts as not loaded.
  const loaded = assets !== undefined;
  const catalogue = useMemo(() => assets ?? [], [assets]);

  // Changes with the clock, so computed once here and memoized, not per row or per tab.
  const states = useMemo(
    () => assetStates(catalogue, incidents ?? [], overview, serverNow),
    [catalogue, incidents, overview, serverNow],
  );

  const zoneName = useMemo(() => new Map(zones.map((z: Zone) => [z.id, z.name])), [zones]);
  const terms = useMemo(() => searchTerms(query), [query]);
  // The search and the zone apply to every tab, so each tab's count is what it would list.
  const counts = useMemo(
    () =>
      countAssetFilters(
        catalogue,
        states,
        (asset) =>
          (zoneId === null || asset.zoneId === zoneId) &&
          matchesAssetQuery(asset, terms, zoneName.get(asset.zoneId)),
      ),
    [catalogue, states, zoneId, terms, zoneName],
  );
  const tabs = ASSET_FILTERS.map((value) => ({
    value,
    label: FILTER_LABELS[value],
    ...(loaded ? { count: counts[value] } : {}),
  }));
  const shown = counts[filter];
  const matchStatus =
    loaded && terms.length > 0 ? `${shown} ${shown === 1 ? 'asset matches' : 'assets match'}` : '';

  return (
    <section id="asset-feed" className={styles.feed} aria-label="Assets">
      <FeedSearch
        value={query}
        onChange={setQuery}
        ref={searchRef}
        className={styles.search}
        label="Search assets"
        placeholder="Search asset, code or zone"
      />
      {/* Always mounted: screen readers announce a change in an existing live region. */}
      <p role="status" className={styles.hidden}>
        {matchStatus}
      </p>
      <Tabs
        label="Filter assets"
        tabs={tabs}
        value={filter}
        onChange={setFilter}
        panelClassName={styles.panel}
      >
        {
          isPending ? (
            isRateLimited(failureReason) ? (
              <RateLimited />
            ) : (
              <AssetSkeleton />
            )
          ) : !loaded ? (
            <LoadFailed
              error={error}
              fallback="Assets could not be loaded."
              isFetching={isFetching}
              onRetry={() => void refetch()}
            />
          ) : catalogue.length === 0 ? (
            <EmptyState>No assets are set up on this site.</EmptyState>
          ) : null
          /* V2-09.6 draws the rows, grouped by zone, here. No empty `ul` meanwhile: it would be
           announced as a list with no items. */
        }
      </Tabs>
    </section>
  );
}

/** Shaped like frame 02's row (glyph tile, name and value, state and code), so nothing jumps. */
function AssetSkeleton() {
  return (
    <div className={styles.list} aria-busy="true">
      <p role="status" className={styles.hidden}>
        Loading assets…
      </p>
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <div key={row} className={styles.skeletonRow}>
          <Skeleton className={styles.skeletonTile} />
          <Skeleton className={styles.skeletonName} />
          <Skeleton className={styles.skeletonMeta} />
        </div>
      ))}
    </div>
  );
}
