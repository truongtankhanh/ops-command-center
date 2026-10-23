import type { Asset, TelemetryValue, Zone } from '@occ/contracts';
import type { AssetFilter, AssetGroup, AssetState } from './assets';
import { formatReading } from './readings';
import { formatAgeCoarse } from '../telemetry/telemetryAge';
import type { AssetTelemetryState, TelemetryPillState } from '../telemetry/telemetryState';
import { formatClockTimeSeconds } from '../time';

/*
 * What the Assets list says and in what order the keyboard walks it (V2-09.6): the value and the
 * state of a row, the flat item list behind the roving focus, the "not updating" notice and the
 * empty-tab messages. Pure: no store, no timer, no clock. The wording is asset-classes.md
 * § Console presentation (the settled copy is recorded under "List words").
 */

/** The label of the group whose zone this console does not have (`groupByZone`'s `zone: null`). */
export const OTHER_ZONES = 'Other zones';

/**
 * One stop of the list, in reading order: a zone's header, then its assets. The keyboard walks the
 * focusable ones; a header that is not (the "Other zones" group, which has no zone to filter by,
 * and the one group left while a zone chip is on) is drawn as text.
 */
export type ListItem =
  | {
      kind: 'group';
      key: string;
      zone: Zone | null;
      name: string;
      count: number;
      focusable: boolean;
    }
  | { kind: 'asset'; key: string; asset: Asset; focusable: true };

export const groupKey = (zone: Pick<Zone, 'id'> | null): string =>
  zone === null ? 'group:other' : `group:${zone.id}`;

export const assetKey = (code: string): string => `asset:${code}`;

/**
 * The flat item list of `groups`. `headersFilter` says a header is a button that sets the zone
 * chip; it is `false` once a zone is chosen, because the chip is then the control and a header that
 * did nothing would only be one more stop.
 */
export function listItems(groups: readonly AssetGroup[], headersFilter: boolean): ListItem[] {
  const items: ListItem[] = [];
  for (const { zone, assets } of groups) {
    items.push({
      kind: 'group',
      key: groupKey(zone),
      zone,
      name: zone === null ? OTHER_ZONES : zone.name,
      count: assets.length,
      focusable: headersFilter && zone !== null,
    });
    for (const asset of assets) {
      items.push({ kind: 'asset', key: assetKey(asset.code), asset, focusable: true });
    }
  }
  return items;
}

/**
 * The row's value: the asset's first headline reading, as an operator reads it. The freshest copy
 * (`values`, which frames and overviews are laid over) wins over the overview's own `headline`.
 * `null` when there is nothing to show: no headline point, no entry for the asset, or no value for
 * the point yet. The caller draws "—".
 */
export function rowValue(
  asset: Pick<Asset, 'headline'>,
  entry: Pick<AssetTelemetryState, 'values' | 'headline'> | undefined,
): string | null {
  const point = asset.headline[0];
  if (point === undefined || entry === undefined) return null;
  const value: TelemetryValue | undefined = entry.values[point.key] ?? entry.headline[point.key];
  return value === undefined ? null : formatReading(point, value);
}

/**
 * The state word of a row, with what makes it exact: the incident's code for a fault, the age of the
 * reading for no data and offline (an asset with no entry has no age to give). `null` for `unknown`:
 * the list draws no word for an asset it cannot judge.
 */
export function stateText(
  state: AssetState,
  { ageMs, incidentCode }: { ageMs: number | null; incidentCode?: string },
): string | null {
  const aged = (word: string) => (ageMs === null ? word : `${word} · ${formatAgeCoarse(ageMs)}`);
  switch (state) {
    case 'fault':
      return incidentCode ? `Fault · ${incidentCode}` : 'Fault';
    case 'nodata':
      return aged('No data');
    case 'offline':
      return aged('Offline');
    case 'standby':
      return 'Standby';
    case 'running':
      return 'Running';
    case 'unknown':
      return null;
  }
}

/** `at` is `null` when no time is known at all: the notice then says only that nothing updates. */
export type AssetNotice = { kind: 'asOf'; at: number | null } | { kind: 'unavailable' };

/** The newest valid `receivedAt` of the overview, as epoch ms; `null` for none. */
function newestReceivedAt(
  overview: Readonly<Record<string, { receivedAt: string }>>,
): number | null {
  let newest: number | null = null;
  for (const { receivedAt } of Object.values(overview)) {
    const at = Date.parse(receivedAt);
    if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

/**
 * The notice above the list while readings are not live (frame 05). *As of* is the newest reading
 * the API received, on the API's clock, which is what the rows' ages are measured from; with none,
 * the time telemetry paused (the API's) or the console's socket went down (this browser's), as the
 * banner says it. Nothing is said while connecting or live. `unavailable` is an API that has no
 * `/telemetry` (a rolling deploy), where there is no time to give.
 */
export function assetNotice({
  pill,
  overview,
  upstreamSince,
  socketSince,
}: {
  pill: TelemetryPillState;
  overview: Readonly<Record<string, { receivedAt: string }>>;
  upstreamSince: string | null;
  socketSince: number | null;
}): AssetNotice | null {
  switch (pill) {
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'paused':
    case 'reconnecting': {
      const since =
        pill === 'paused'
          ? upstreamSince === null
            ? NaN
            : Date.parse(upstreamSince)
          : socketSince;
      const fallback = since !== null && Number.isFinite(since) ? since : null;
      return { kind: 'asOf', at: newestReceivedAt(overview) ?? fallback };
    }
    default:
      return null;
  }
}

export function noticeText(notice: AssetNotice): string {
  if (notice.kind === 'unavailable') return 'No readings: telemetry is unavailable';
  return notice.at === null
    ? 'Readings are not updating'
    : `Readings as of ${formatClockTimeSeconds(notice.at)} — not updating`;
}

/**
 * What the list says when a tab, a search and a zone leave nothing to show. The message always says
 * why, search first (as `feedEmptyMessage`): a search that matches nothing is not "no faults".
 * `zoneName` is the chosen zone's name, or `null`.
 */
export function assetEmptyMessage(
  filter: AssetFilter,
  query: string,
  zoneName: string | null,
): string {
  const search = query.trim();
  if (search !== '') return `No assets match "${search}".`;
  switch (filter) {
    case 'faults':
      return zoneName === null
        ? 'No assets have a fault.'
        : `No assets in ${zoneName} have a fault.`;
    case 'nodata':
      return zoneName === null
        ? 'No assets are without data.'
        : `No assets in ${zoneName} are without data.`;
    case 'all':
      return zoneName === null ? 'No assets are set up on this site.' : `No assets in ${zoneName}.`;
  }
}
