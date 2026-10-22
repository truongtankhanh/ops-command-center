import type { LngLat } from './geo';

/** How a zone is drawn, not what it is used for (that is `ZoneUse`, ADR-0021). */
export const ZONE_KINDS = [
  'building',
  'parking',
  'gate',
  'outdoor',
  'sports',
  'utility',
  'water',
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** What a `building` zone is used for (ADR-0021). Other kinds have no use. */
export const ZONE_USES = [
  'academic',
  'library',
  'laboratory',
  'residential',
  'dining',
  'healthcare',
  'sports_hall',
  'administration',
  'data_center',
  'security_post',
  'utility_plant',
] as const;
export type ZoneUse = (typeof ZONE_USES)[number];

/** A level code: `L1`, `L2`, `B1`, `ROOF` (ADR-0023). Server-side validation and the console's form share it. */
export const LEVEL_CODE_PATTERN = /^[A-Z0-9]{1,8}$/;

/** The level at a building's `heightM`: plant and the roof's devices stand on it (ADR-0023). */
export const ROOF_LEVEL_CODE = 'ROOF';

/** One level of a building: a slab at a height, with the label operators read ("Level 2", "Roof"). */
export interface ZoneLevel {
  /** Matches `LEVEL_CODE_PATTERN` and is unique within the zone. */
  code: string;
  label: string;
  /** Metres above ground of the level's slab: ≥ 0. */
  elevationM: number;
}

export interface Zone {
  id: string;
  code: string;
  name: string;
  kind: ZoneKind;
  /**
   * Buildings only; drives report-form suggestions and restricts nothing. A client reads a missing
   * `use` as `null`: an API before the `zone.use` column never sends it.
   */
  use?: ZoneUse | null;
  /**
   * Metres above ground of a building's shell; `null` is the client's default. A client reads a
   * missing `heightM` as `null`: an API before the `zone.height_m` column never sends it.
   */
  heightM?: number | null;
  /**
   * A building's levels, ordered from the lowest (ADR-0023). A client reads a missing `levels` as
   * `[]`: an API before `building_level` never sends it, and a zone that is not a building has none.
   */
  levels?: ZoneLevel[];
  /** Closed ring of [lng, lat] points. */
  polygon: LngLat[];
  center: LngLat;
}
