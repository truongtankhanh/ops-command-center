import type { Incident } from '@occ/contracts';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isRateLimited } from '../api/client';
import { useAssets, useIncidents, useZones } from '../api/queries';
import {
  assetEmptyMessage,
  assetKey,
  assetNotice,
  groupKey,
  listItems,
  noticeText,
} from '../lib/assets/assetList';
import {
  ASSET_FILTERS,
  type AssetFilter,
  assetStates,
  countAssetFilters,
  groupByZone,
  matchesAssetFilter,
  matchesAssetQuery,
  openIncidentOf,
} from '../lib/assets/assets';
import { searchTerms } from '../lib/incidents/incidents';
import { nextRowIndex } from '../lib/incidents/rowNavigation';
import { ageMs, isStale, staleAfterMs } from '../lib/telemetry/telemetryFreshness';
import { buildingFocusOf } from '../lib/twinLevel';
import { useShortcut } from '../lib/useShortcut';
import { useServerNow, useTelemetryStatus, useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { EmptyState } from '../ui/EmptyState';
import { FilterChip } from '../ui/FilterChip';
import { Icon } from '../ui/Icon';
import { Clock, Search, unknownIcon, zoneKindIcon } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { Tabs } from '../ui/Tabs';
import styles from './AssetFeed.module.css';
import { AssetRow } from './AssetRow';
import { FeedSearch } from './FeedSearch';
import { LoadFailed, RateLimited } from './LoadStates';

/** As many placeholder rows as the incident feed's, enough to fill the column's first screen. */
const SKELETON_ROWS = 5;

const FILTER_LABELS: Record<AssetFilter, string> = {
  all: 'All',
  faults: 'Faults',
  nodata: 'No data',
};

/** What a row is told beyond its asset: how old its reading is when it is not live, and its incident. */
interface RowFacts {
  ageMs: number | null;
  incident: Incident | undefined;
}

/**
 * The Assets tab of the side panel (frames 02, 03 and 05): the search, the three filter tabs with
 * their counts, the zone chip, the "not updating" notice, and the assets in their zones.
 *
 * One roving set holds the zone headers and the rows: one Tab stop for the whole list, ↑ ↓ Home End
 * move focus, and Enter / Space is each button's own activation (a header filters, a row selects).
 * A header is a button only while no zone is chosen: the chip is then the control, and a header
 * that did nothing would be one more stop. The "Other zones" group has no zone to filter by.
 *
 * Mounted while the Incidents panel shows (the panel is only `hidden`), so `/` is enabled only while
 * this panel is the visible one.
 */
export function AssetFeed() {
  const { data: assets, error, failureReason, isPending, isFetching, refetch } = useAssets();
  const { data: incidents } = useIncidents();
  const { data: zoneList } = useZones();
  const overview = useTelemetryStore((s) => s.view.state.assets);
  const { pill, upstreamSince, socketSince } = useTelemetryStatus();
  const serverNow = useServerNow();
  const filter = useConsole((s) => s.assetFilter);
  const setFilter = useConsole((s) => s.setAssetFilter);
  const zoneId = useConsole((s) => s.assetZoneId);
  const setZone = useConsole((s) => s.setAssetZone);
  const selectedCode = useConsole((s) => s.selectedAssetCode);
  const visiblePanel = useConsole((s) => s.sidePanel === 'assets');
  const [query, setQuery] = useState('');
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const feedRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const focusChipNext = useRef(false);
  const elements = useRef(new Map<string, HTMLButtonElement>());

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);
  useShortcut('/', focusSearch, visiblePanel);

  // Data first, as the incident feed: a failed background refetch keeps the list, so only a
  // catalogue that never arrived counts as not loaded.
  const loaded = assets !== undefined;
  const catalogue = useMemo(() => assets ?? [], [assets]);
  const zones = useMemo(() => zoneList ?? [], [zoneList]);

  // Changes with the clock, so computed once here and memoized, not per row or per tab.
  const states = useMemo(
    () => assetStates(catalogue, incidents ?? [], overview, serverNow),
    [catalogue, incidents, overview, serverNow],
  );

  const zoneName = useMemo(() => new Map(zones.map((zone) => [zone.id, zone.name])), [zones]);
  const terms = useMemo(() => searchTerms(query), [query]);
  // The search and the zone apply to every tab, so each tab's count is what it would list.
  const scoped = useMemo(
    () =>
      catalogue.filter(
        (asset) =>
          (zoneId === null || asset.zoneId === zoneId) &&
          matchesAssetQuery(asset, terms, zoneName.get(asset.zoneId)),
      ),
    [catalogue, zoneId, terms, zoneName],
  );
  const counts = useMemo(() => countAssetFilters(scoped, states), [scoped, states]);
  const tabs = ASSET_FILTERS.map((value) => ({
    value,
    label: FILTER_LABELS[value],
    ...(loaded ? { count: counts[value] } : {}),
  }));
  const visible = useMemo(
    () => scoped.filter((asset) => matchesAssetFilter(states.get(asset.code), filter)),
    [scoped, states, filter],
  );
  const matchStatus =
    loaded && terms.length > 0
      ? `${visible.length} ${visible.length === 1 ? 'asset matches' : 'assets match'}`
      : '';

  const groups = useMemo(() => groupByZone(visible, zones), [visible, zones]);
  const items = useMemo(() => listItems(groups, zoneId === null), [groups, zoneId]);
  const headers = useMemo(() => items.filter((item) => item.kind === 'group'), [items]);
  const focusable = useMemo(() => items.filter((item) => item.focusable), [items]);

  // The facts a row cannot get from its own asset: how old a reading that is not live is, and the
  // incident of a fault. Both are primitives or stored references, so a live row's props stay equal
  // from one second to the next and the memoized row is not rendered.
  const facts = useMemo(() => {
    const byCode = new Map<string, RowFacts>();
    for (const asset of visible) {
      const entry = overview[asset.code];
      // Stale or offline whatever the state word is: a fault keeps its values drawn as stale.
      let age: number | null = null;
      if (
        entry !== undefined &&
        serverNow !== null &&
        (!entry.online || isStale(entry.receivedAt, staleAfterMs(asset.headline), serverNow))
      ) {
        age = ageMs(entry.receivedAt, serverNow);
      }
      byCode.set(asset.code, {
        ageMs: age,
        incident:
          states.get(asset.code) === 'fault' ? openIncidentOf(asset, incidents ?? []) : undefined,
      });
    }
    return byCode;
  }, [visible, overview, serverNow, states, incidents]);

  const notice = useMemo(
    () => assetNotice({ pill, overview, upstreamSince, socketSince }),
    [pill, overview, upstreamSince, socketSince],
  );

  // One Tab stop for the whole list: the item focused last, else the selected asset, else the first.
  // Tracked by key, so a live re-sort or a filter does not move it to another asset.
  const present = (key: string | null): key is string =>
    key !== null && focusable.some((item) => item.key === key);
  const selectedKey = selectedCode === null ? null : assetKey(selectedCode);
  const tabStopKey = present(focusKey)
    ? focusKey
    : present(selectedKey)
      ? selectedKey
      : focusable[0]?.key;

  const register = useCallback((key: string, element: HTMLButtonElement | null) => {
    if (element) elements.current.set(key, element);
    else elements.current.delete(key);
  }, []);
  const onFocusItem = useCallback((key: string) => setFocusKey(key), []);

  // Arrows move focus only (a list does not wrap); Enter and Space are the buttons' own.
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = focusable.findIndex((item) => elements.current.get(item.key) === event.target);
    if (current < 0) return;
    const next = nextRowIndex(event.key, current, focusable.length);
    if (next === null) return;
    const target = focusable[next];
    if (!target) return;
    event.preventDefault();
    elements.current.get(target.key)?.focus();
  };

  const filterByZone = (id: string) => {
    focusChipNext.current = true;
    setZone(id);
  };
  // The header that was pressed is plain text now, so focus goes to the chip, the control that took
  // its place; and when the chip is cleared, to the selected tab, the nearest stable control.
  useEffect(() => {
    if (!focusChipNext.current || zoneId === null) return;
    focusChipNext.current = false;
    chipRef.current?.querySelector('button')?.focus();
  }, [zoneId]);
  const clearZone = () => {
    setZone(null);
    feedRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  };

  // A row that leaves the list sends no `mouseleave`: drop its hover, but only when this list was
  // what removed it, so the map's own hover (V2-10.4) is not fought.
  const previouslyVisible = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const now = new Set(visible.map((asset) => asset.code));
    const hovered = useConsole.getState().hoveredAssetCode;
    if (hovered !== null && previouslyVisible.current.has(hovered) && !now.has(hovered)) {
      useConsole.getState().hoverAsset(null);
    }
    previouslyVisible.current = now;
  }, [visible]);

  const chosenZone = zoneId === null ? undefined : zones.find((zone) => zone.id === zoneId);
  const emptyMessage = assetEmptyMessage(
    filter,
    query,
    zoneId === null ? null : (chosenZone?.name ?? 'this zone'),
  );

  return (
    <section ref={feedRef} id="asset-feed" className={styles.feed} aria-label="Assets">
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
        {isPending ? (
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
        ) : (
          <>
            {zoneId !== null && (
              <FilterChip
                ref={chipRef}
                glyph={chosenZone ? zoneKindIcon(chosenZone.kind) : unknownIcon}
                label={`${chosenZone?.name ?? 'This zone'} only`}
                clearLabel="Clear zone filter"
                onClear={clearZone}
                className={styles.chip}
              />
            )}
            {/* Frame 05: what the rows show is the last known state, and the banner says why. */}
            {notice !== null && (
              <p className={styles.notice}>
                <Icon glyph={Clock} size={14} />
                {noticeText(notice)}
              </p>
            )}
            {visible.length === 0 ? (
              // A search gets the search glyph and no action: its own box has "Clear search".
              terms.length > 0 ? (
                <EmptyState icon={Search}>{emptyMessage}</EmptyState>
              ) : (
                <EmptyState>{emptyMessage}</EmptyState>
              )
            ) : (
              <ul className={styles.list} onKeyDown={onListKeyDown}>
                {groups.map((group, index) => {
                  const header = headers[index];
                  if (!header) return null;
                  const key = groupKey(group.zone);
                  return (
                    <li key={key} className={styles.group}>
                      {header.focusable && group.zone !== null ? (
                        <GroupHeader
                          itemKey={header.key}
                          name={header.name}
                          zoneId={group.zone.id}
                          tabIndex={header.key === tabStopKey ? 0 : -1}
                          register={register}
                          onFocusItem={onFocusItem}
                          onFilter={filterByZone}
                        />
                      ) : (
                        <p className={styles.groupName}>{header.name}</p>
                      )}
                      <ul className={styles.rows} aria-label={header.name}>
                        {group.assets.map((asset) => {
                          const itemKey = assetKey(asset.code);
                          const rowFacts = facts.get(asset.code);
                          return (
                            <li key={asset.code}>
                              <AssetRow
                                asset={asset}
                                state={states.get(asset.code) ?? 'unknown'}
                                incident={rowFacts?.incident}
                                ageMs={rowFacts?.ageMs ?? null}
                                focusZoneId={buildingFocusOf(asset, zones)}
                                itemKey={itemKey}
                                tabIndex={itemKey === tabStopKey ? 0 : -1}
                                register={register}
                                onFocusItem={onFocusItem}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Tabs>
    </section>
  );
}

/**
 * A zone's name above its assets, as a button that shows this zone only. The visible text is the
 * name (frame 02); the accessible name starts with it and says what the button does.
 */
function GroupHeader({
  itemKey,
  name,
  zoneId,
  tabIndex,
  register,
  onFocusItem,
  onFilter,
}: {
  itemKey: string;
  name: string;
  zoneId: string;
  tabIndex: 0 | -1;
  register: (key: string, element: HTMLButtonElement | null) => void;
  onFocusItem: (key: string) => void;
  onFilter: (zoneId: string) => void;
}) {
  return (
    <button
      ref={(element) => register(itemKey, element)}
      type="button"
      tabIndex={tabIndex}
      className={styles.groupHeader}
      aria-label={`Show only ${name}`}
      onFocus={() => onFocusItem(itemKey)}
      onClick={() => onFilter(zoneId)}
    >
      {name}
    </button>
  );
}

/** Shaped like frame 02's row (glyph tile, name and value, state and code), so nothing jumps. */
function AssetSkeleton() {
  return (
    <div className={styles.skeletonList} aria-busy="true">
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
