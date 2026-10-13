/**
 * Reference data for the demo campus's equipment (ADR-0018): the 31 assets of `asset-classes.md`
 * § Demo assets, which is the source. Change the document and this file together.
 *
 * A top-up inserts the assets that are absent and never rewrites one that exists (ADR-0017), so
 * editing a value here reaches an empty database only. A volume that already has the row keeps its
 * value; an `unverified` position or elevation is corrected by a data edit, not by this file.
 */

export interface AssetSeed {
  /** The operators' tag, `^[A-Z]{2,4}-[A-Z0-9]{2,6}$` (`asset_code_check`). */
  code: string;
  name: string;
  /** An `asset_class.code` of `ASSET_CLASSES`. */
  class: string;
  /** A `zone.code` of `ZONES`: the zone the asset stands in, or within 5 m of. */
  zone: string;
  /**
   * [east, north] metres from the **campus centre**, east and north positive. Not relative to the
   * zone as `CameraSeed.at` is: the document's table is in campus coordinates, and the 3D scene
   * reads the same numbers.
   */
  at: [east: number, north: number];
  /** Metres of the base above ground, `≥ 0`. A roof is the building's `heightM`. */
  elevationM: number;
  /** Degrees clockwise from true north, `0 ≤ x < 360`. Nothing in the design is rotated: all 0. */
  headingDeg: number;
}

/**
 * Append only, in the order of `asset-classes.md` § Demo assets: the equipment in the order of the
 * classes, then the nine indoor climate sensors, one per building that has no air handler.
 */
export const ASSETS: AssetSeed[] = [
  {
    code: 'CT-01',
    name: 'Cooling tower 1',
    class: 'cooling_tower',
    zone: 'BLD-DC',
    at: [161, 48],
    elevationM: 14,
    headingDeg: 0,
  },
  {
    code: 'CT-02',
    name: 'Cooling tower 2',
    class: 'cooling_tower',
    zone: 'BLD-DC',
    at: [174, 48],
    elevationM: 14,
    headingDeg: 0,
  },
  // 3 m east of the building: the east yard belongs to no zone, and frame 02 groups it under the
  // Data Center.
  {
    code: 'GEN-01',
    name: 'Standby generator',
    class: 'standby_generator',
    zone: 'BLD-DC',
    at: [208, 46.5],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'UPS-01',
    name: 'UPS room',
    class: 'ups',
    zone: 'BLD-DC',
    at: [164.5, 29.7],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'BAT-01',
    name: 'UPS batteries',
    class: 'ups_battery',
    zone: 'BLD-DC',
    at: [179.5, 29.7],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'CRAC-01',
    name: 'Precision cooling 1',
    class: 'precision_cooling',
    zone: 'BLD-DC',
    at: [190, 50.2],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'CRAC-02',
    name: 'Precision cooling 2',
    class: 'precision_cooling',
    zone: 'BLD-DC',
    at: [190, 42.25],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'TR-01',
    name: 'Main transformer',
    class: 'transformer',
    zone: 'UTL-PLANT',
    at: [94, 216],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'SWG-01',
    name: 'Main switchgear',
    class: 'switchgear',
    zone: 'UTL-PLANT',
    at: [46, 215],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'CH-01',
    name: 'Chiller 1',
    class: 'chiller',
    zone: 'UTL-PLANT',
    at: [30, 200],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'AHU-C1',
    name: 'Air handler',
    class: 'air_handler',
    zone: 'BLD-CLINIC',
    at: [183, -240],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'AHU-L1',
    name: 'Air handler, level 1',
    class: 'air_handler',
    zone: 'BLD-LIB',
    at: [40, 120],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'AHU-H1',
    name: 'Air handler, roof',
    class: 'air_handler',
    zone: 'BLD-HUB',
    at: [-130, 60],
    elevationM: 24,
    headingDeg: 0,
  },
  {
    code: 'PMP-S1',
    name: 'Booster pump',
    class: 'booster_pump',
    zone: 'BLD-STU',
    at: [110, -95],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'LFT-A2',
    name: 'Lift 2',
    class: 'lift',
    zone: 'BLD-DORA',
    at: [60, -172],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'LFT-B1',
    name: 'Lift 1',
    class: 'lift',
    zone: 'BLD-DORB',
    at: [152, -170],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'LFT-H1',
    name: 'Passenger lift',
    class: 'lift',
    zone: 'BLD-HUB',
    at: [-100, 45],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'BAR-01',
    name: 'Barrier arm, inbound',
    class: 'barrier_arm',
    zone: 'GATE-MAIN',
    at: [8, -252],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'BAR-02',
    name: 'Barrier arm, service',
    class: 'barrier_arm',
    zone: 'GATE-EAST',
    at: [216, -55],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'FH-L1',
    name: 'Fume hoods, level 2',
    class: 'fume_hood',
    zone: 'BLD-LAB',
    at: [150, 205],
    elevationM: 4,
    headingDeg: 0,
  },
  {
    code: 'GAS-L1',
    name: 'Gas detector',
    class: 'gas_detector',
    zone: 'BLD-LAB',
    at: [192, 200],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'LKS-B3',
    name: 'Leak sensor, level 3',
    class: 'leak_sensor',
    zone: 'BLD-DORB',
    at: [204, -193],
    elevationM: 8,
    headingDeg: 0,
  },
  // The nine sensors have no position in the design: each sits at its building's centre
  // (`unverified`, asset-classes.md).
  {
    code: 'ICS-DC',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-DC',
    at: [175, 40],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'ICS-LHA',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-LHA',
    at: [-60, -110],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'ICS-STU',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-STU',
    at: [110, -95],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'ICS-LAB',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-LAB',
    at: [170, 212],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'ICS-DORA',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-DORA',
    at: [80, -181.5],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'ICS-DORB',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-DORB',
    at: [178.5, -181.5],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'ICS-SPORTS',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-SPORTS',
    at: [-40, 207],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'ICS-ADMIN',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-ADMIN',
    at: [-226, -14],
    elevationM: 0,
    headingDeg: 0,
  },
  {
    code: 'ICS-SEC',
    name: 'Indoor climate sensor',
    class: 'indoor_climate',
    zone: 'BLD-SEC',
    at: [42, -251.5],
    elevationM: 0,
    headingDeg: 0,
  },
];
