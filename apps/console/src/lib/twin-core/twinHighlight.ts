import type { Incident, Zone } from '@occ/contracts';
import { type Mesh, roadRibbon } from './twinGround';
import { flatZones, type Frame } from './twinScene';

/*
 * The outline of the zone an incident or a report is about, on the 3D ground (V2-16.4, ADR-0020 "Settled in
 * V2-16.4"): which zone, and its ring as a flat ribbon, as plain data. No `three`, no store and no DOM, so the rule
 * and the geometry are tested without WebGL. `twin/ZoneHighlight.tsx` draws it.
 */

/**
 * The ribbon's width in metres. The 2D map's outline is 2 px; a WebGL line is always 1 px, so the outline is a mesh
 * and its width is in metres, which means it thins with distance. `unverified`: tuned by eye at the campus view.
 */
export const HIGHLIGHT_WIDTH_M = 2;

export interface HighlightInput {
  /** The report form is open. */
  reporting: boolean;
  /** The zone chosen in the report form, or `null` when none is. */
  reportZoneId: string | null;
  selectedIncidentId: string | null;
  /** The incident list, `undefined` while it loads. */
  incidents: readonly Incident[] | undefined;
}

/**
 * The zone to outline, the 2D map's rule (`CampusMap`): the report's zone while the form is open (and none until one
 * is chosen: the selected incident's zone is not the report's), else the selected incident's zone. Nothing when no
 * incident is selected, when the list has not loaded, or when it does not hold the selected one.
 */
export function highlightZoneOf({
  reporting,
  reportZoneId,
  selectedIncidentId,
  incidents,
}: HighlightInput): string | null {
  if (reporting) return reportZoneId;
  if (selectedIncidentId === null) return null;
  return incidents?.find((incident) => incident.id === selectedIncidentId)?.zoneId ?? null;
}

/**
 * The ring of zone `zoneId` as a flat ribbon `widthM` wide, centred on the outline, in scene metres (the road
 * ribbon's builder, joins rounded). `null` for a zone the list does not hold or whose ring is not an area.
 */
export function highlightRibbon(
  zones: readonly Zone[],
  frame: Frame,
  zoneId: string,
  widthM: number = HIGHLIGHT_WIDTH_M,
): Mesh | null {
  const zone = zones.find((candidate) => candidate.id === zoneId);
  if (zone === undefined) return null;
  const [flat] = flatZones([zone], frame);
  if (flat === undefined || flat.ring.length < 3) return null;
  return roadRibbon([{ closed: true, points: flat.ring }], widthM);
}
