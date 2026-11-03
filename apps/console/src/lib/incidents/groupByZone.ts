import { type Incident, type IncidentSeverity, severityRank, type Zone } from '@occ/contracts';

/*
 * The grouped feed's shape (V3-21.4, frame 16): during an alarm flood the feed can show one row per zone instead of one per
 * incident. It is a view of the same incidents, derived in the browser from the list the feed already has: nothing is stored or
 * sent, and real grouping of related alarms is V4. Pure, like `alarmLoad.ts` beside it: no React, no `Date.now()`.
 */

/** The group of an incident whose zone the loaded zones lack. Not a real zone id, so it cannot clash with one. */
export const OTHER_ZONE_ID = 'other';
export const OTHER_ZONE_NAME = 'Other zone';

export interface ZoneGroup {
  zoneId: string;
  name: string;
  /** Every incident of the zone in the list given. */
  count: number;
  /** Those still `open` (unacknowledged), as Standing and the status chip use the word. */
  open: number;
  /** The highest severity in the group. */
  worst: IncidentSeverity;
  /** The latest `reportedAt`, in epoch ms; `null` when none parses. */
  newestAt: number | null;
  /** The group's incidents, in the order they came in, so an expanded group lists them as the feed does. */
  incidents: Incident[];
}

/** Plain code-unit order, not `localeCompare`: the order of ties must be the same on every console (as the model's). */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One group per zone that has an incident in `incidents`, ordered by the worst severity (most severe first), then by the count
 * (most first), then by name, then by zone id. An incident whose zone is not in `zones` joins one group "Other zone", ordered by
 * the same rule. The input is not changed.
 */
export function groupByZone(
  incidents: readonly Incident[],
  zones: readonly Pick<Zone, 'id' | 'name'>[],
): ZoneGroup[] {
  const names = new Map(zones.map((zone) => [zone.id, zone.name]));
  const groups = new Map<string, ZoneGroup>();

  for (const incident of incidents) {
    const known = names.has(incident.zoneId);
    const zoneId = known ? incident.zoneId : OTHER_ZONE_ID;
    const reportedAt = Date.parse(incident.reportedAt);
    const group = groups.get(zoneId);
    if (group === undefined) {
      groups.set(zoneId, {
        zoneId,
        name: known ? (names.get(incident.zoneId) ?? OTHER_ZONE_NAME) : OTHER_ZONE_NAME,
        count: 1,
        open: incident.status === 'open' ? 1 : 0,
        worst: incident.severity,
        newestAt: Number.isNaN(reportedAt) ? null : reportedAt,
        incidents: [incident],
      });
      continue;
    }
    group.count += 1;
    if (incident.status === 'open') group.open += 1;
    if (severityRank(incident.severity) > severityRank(group.worst))
      group.worst = incident.severity;
    if (!Number.isNaN(reportedAt) && (group.newestAt === null || reportedAt > group.newestAt)) {
      group.newestAt = reportedAt;
    }
    group.incidents.push(incident);
  }

  return [...groups.values()].sort(
    (a, b) =>
      severityRank(b.worst) - severityRank(a.worst) ||
      b.count - a.count ||
      byText(a.name, b.name) ||
      byText(a.zoneId, b.zoneId),
  );
}

/** What the grouped feed draws, in order: a row for each group and, after an expanded one, a row for each of its incidents. */
export type FeedEntry =
  | { kind: 'group'; id: string; group: ZoneGroup }
  | { kind: 'incident'; id: string; incident: Incident; groupId: string };

/** The id of a group's row, which is also what a keyboard tab stop and a row ref are keyed by. */
export const groupEntryId = (zoneId: string): string => `zone:${zoneId}`;

/**
 * The flat list the feed renders while it is grouped. One place says what the rows are, so the row refs, the roving tab stop and
 * the arrow keys all key by what is drawn and not by the incidents behind it. `expanded` holds zone ids.
 */
export function groupedEntries(
  groups: readonly ZoneGroup[],
  expanded: ReadonlySet<string>,
): FeedEntry[] {
  return groups.flatMap((group): FeedEntry[] => {
    const id = groupEntryId(group.zoneId);
    const row: FeedEntry = { kind: 'group', id, group };
    if (!expanded.has(group.zoneId)) return [row];
    return [
      row,
      ...group.incidents.map((incident): FeedEntry => ({
        kind: 'incident',
        id: incident.id,
        incident,
        groupId: id,
      })),
    ];
  });
}

/** The row id of the group an incident is in, or `null` when the groups do not hold it (a collapsed group still does). */
export function groupIdOf(groups: readonly ZoneGroup[], incidentId: string): string | null {
  const group = groups.find((candidate) =>
    candidate.incidents.some((incident) => incident.id === incidentId),
  );
  return group ? groupEntryId(group.zoneId) : null;
}
