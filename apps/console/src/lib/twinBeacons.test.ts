import type {
  Asset,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  LngLat,
  Zone,
  ZoneKind,
} from '@occ/contracts';
import { offsetM } from './geo';
import { fanOut, incidentFeatures, UNKNOWN_TYPE_IMAGE } from './mapFeatures';
import { type Beacon, beaconsOf } from './twinBeacons';
import { DEFAULT_BUILDING_HEIGHT_M, makeFrame } from './twinScene';

/*
 * The demo campus, copied: the zones the frames' incidents sit in and the cooling tower the telemetry incident is
 * raised on, in metres east and north of the campus centre. The sources are `docs/design/v2/asset-classes.md`
 * § Demo assets, `seed/campus.ts` (zones) and frames 01 and 04 (`beacons`, `rows`); the console cannot import the
 * API's seed (ADR-0001), so there is no guard against drift but this test (as in `twinPlacement.test.ts`). The seed's
 * own incidents are not frame 01's eight (it has no `suspicious_object`), so the eight are built from the frame.
 */
const CENTER: LngLat = [108.4415, 11.953];
const frame = makeFrame(CENTER);

/** A zone as the API serves it: a rectangle of `size` metres centred `at` metres east and north of the centre. */
function zoneAt(
  code: string,
  kind: ZoneKind,
  at: [number, number],
  size: [number, number],
  heightM?: number,
): Zone {
  const [east, north] = at;
  const [width, depth] = size;
  const corner = (x: number, y: number) => offsetM(CENTER, east + x * width, north + y * depth);
  return {
    id: code,
    code,
    name: code,
    kind,
    ...(heightM === undefined ? {} : { heightM }),
    polygon: [
      corner(-0.5, -0.5),
      corner(0.5, -0.5),
      corner(0.5, 0.5),
      corner(-0.5, 0.5),
      corner(-0.5, -0.5),
    ],
    center: offsetM(CENTER, east, north),
  };
}

const ZONES: Zone[] = [
  zoneAt('GATE-MAIN', 'gate', [0, -250], [44, 22]),
  zoneAt('PRK-EAST', 'parking', [185, 140], [60, 40]),
  zoneAt('BLD-HUB', 'building', [-120, 60], [90, 60], 24),
  zoneAt('BLD-DC', 'building', [175, 40], [60, 46], 14),
  zoneAt('BLD-STU', 'building', [110, -95], [72, 50], 12),
  zoneAt('BLD-LAB', 'building', [170, 212], [90, 64], 16),
  zoneAt('BLD-DORB', 'building', [178.5, -181.5], [87, 47], 20),
  zoneAt('BLD-SPORTS', 'building', [-40, 207], [80, 74], 14),
  // A building the API served without a height: it is drawn at the default, so a roof incident stands there.
  zoneAt('BLD-NOHEIGHT', 'building', [-200, -150], [60, 40]),
];

const TOWER_HEIGHT_M = 5;
const ROOF_M = 14;

/** CT-01 as the catalogue holds it: on the data center's roof, a 4 × 4 × 5 m class (`asset-classes.md`). */
const CT01: Asset = {
  id: 'asset-ct01',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: '/models/cooling_tower.glb',
    footprintM: { width: 4, depth: 4, height: TOWER_HEIGHT_M },
  },
  zoneId: 'BLD-DC',
  position: offsetM(CENTER, 161, 48),
  elevationM: ROOF_M,
  headingDeg: 0,
  headline: [],
};

const T0 = Date.parse('2026-10-20T08:00:00.000Z');

/** An incident at `at` metres east and north of the centre; `reportedAt` grows with the order of calls. */
let serial = 0;
function incident(
  code: string,
  type: IncidentType,
  severity: IncidentSeverity,
  status: IncidentStatus,
  zoneId: string,
  at: [number, number],
  extra: Partial<Incident> = {},
): Incident {
  serial += 1;
  return {
    id: `id-${code}`,
    code,
    type,
    severity,
    status,
    title: code,
    description: null,
    zoneId,
    position: offsetM(CENTER, at[0], at[1]),
    source: 'operator',
    assetId: null,
    reportedAt: new Date(T0 + serial * 60_000).toISOString(),
    acknowledgedAt: status === 'open' ? null : new Date(T0 + serial * 60_000 + 1_000).toISOString(),
    resolvedAt: status === 'resolved' ? new Date(T0 + serial * 60_000 + 2_000).toISOString() : null,
    version: 1,
    ...extra,
  };
}

/** Frame 01's eight active incidents (its `beacons` and `rows`), at the places the frame draws them. */
const FRAME_01: Incident[] = [
  incident('INC-000110', 'fire_alarm', 'high', 'open', 'BLD-LAB', [170, 212]),
  // The service corridor stands in the footprint's inset band, so it is outdoors (frame 01 draws it at 0).
  incident('INC-000104', 'intrusion', 'high', 'open', 'BLD-HUB', [-100, 36]),
  incident('INC-000108', 'water_leak', 'medium', 'acknowledged', 'BLD-DORB', [178.5, -181.5]),
  incident('INC-000103', 'suspicious_object', 'medium', 'acknowledged', 'BLD-STU', [122, -116]),
  incident('INC-000109', 'injury', 'medium', 'acknowledged', 'BLD-SPORTS', [-40, 207]),
  incident('INC-000105', 'equipment_fault', 'medium', 'acknowledged', 'BLD-DC', [200, 20]),
  incident('INC-000111', 'blocked_access', 'low', 'open', 'PRK-EAST', [185, 140]),
  incident('INC-000106', 'crowding', 'low', 'open', 'GATE-MAIN', [0, -248]),
];

/** Frame 04's ninth: the critical incident the tower's motor rule raised, at the tower's position. */
const TELEMETRY = incident(
  'INC-000107',
  'equipment_fault',
  'critical',
  'open',
  'BLD-DC',
  [161, 48],
  { assetId: CT01.id, source: 'telemetry' },
);

/** What the frame draws for each of the eight: filled for open, hollow for acknowledged. */
const FORMS: Record<string, Beacon['form']> = {
  'INC-000110': 'filled',
  'INC-000104': 'filled',
  'INC-000108': 'hollow',
  'INC-000103': 'hollow',
  'INC-000109': 'hollow',
  'INC-000105': 'hollow',
  'INC-000111': 'filled',
  'INC-000106': 'filled',
};

/** Where a beacon stands on the ground in the scene: the map's fanned-out position through the frame. */
const groundOf = (all: readonly Incident[], id: string): [number, number] => {
  const position = fanOut(all).get(id);
  if (position === undefined) throw new Error(`no position for ${id}`);
  return frame.toLocal(position);
};

const run = (
  incidents: readonly Incident[],
  options: Partial<Parameters<typeof beaconsOf>[0]> = {},
): Beacon[] =>
  beaconsOf({ incidents, selectedId: null, assets: [CT01], zones: ZONES, frame, ...options });

const byCode = (beacons: readonly Beacon[], code: string): Beacon => {
  const beacon = beacons.find((candidate) => candidate.code === code);
  if (beacon === undefined) throw new Error(`no beacon ${code}`);
  return beacon;
};

describe('beaconsOf', () => {
  describe("frame 01's eight incidents", () => {
    const beacons = run(FRAME_01);

    it('gives eight beacons, one for each, in the order of their codes', () => {
      expect(beacons.map((beacon) => beacon.code)).toEqual(FRAME_01.map((i) => i.code).sort());
    });

    it('fills the open ones and leaves the acknowledged ones hollow, as the frame draws them', () => {
      expect(Object.fromEntries(beacons.map((b) => [b.code, b.form]))).toEqual(FORMS);
    });

    it('has no larger, pulsing or tagged beacon: none is critical or raised by an asset', () => {
      expect(beacons.some((beacon) => beacon.big || beacon.pulse || beacon.tag !== null)).toBe(
        false,
      );
      expect(beacons.every((beacon) => !beacon.selected)).toBe(true);
    });

    it('carries each incident’s severity and type, an unknown one aside', () => {
      expect(byCode(beacons, 'INC-000110')).toMatchObject({
        id: 'id-INC-000110',
        severity: 'high',
        type: 'fire_alarm',
      });
      expect(byCode(beacons, 'INC-000106')).toMatchObject({ severity: 'low', type: 'crowding' });
    });

    it('stands an incident inside a building on its roof and every other at the ground', () => {
      const heights = Object.fromEntries(beacons.map((b) => [b.code, b.position[1]]));
      expect(heights).toEqual({
        'INC-000110': 16, // Science Lab
        'INC-000104': 0, // the service corridor, in the inset band
        'INC-000108': 20, // Dormitory B
        'INC-000103': 0, // the plaza, outside the footprint
        'INC-000109': 14, // Sports Hall
        'INC-000105': 0, // the loading bay, in the inset band
        'INC-000111': 0, // a parking zone has no roof
        'INC-000106': 0, // the gate
      });
    });

    it('takes x and z from the map’s position through the scene frame', () => {
      for (const beacon of beacons) {
        const [x, z] = groundOf(FRAME_01, beacon.id);
        expect(beacon.position[0]).toBeCloseTo(x, 9);
        expect(beacon.position[2]).toBeCloseTo(z, 9);
      }
    });
  });

  describe('the telemetry incident of frame 04', () => {
    const all = [...FRAME_01, TELEMETRY];

    it('is the ninth beacon, critical, larger, pulsing and tagged with the asset’s code', () => {
      const beacons = run(all);

      expect(beacons).toHaveLength(9);
      expect(byCode(beacons, 'INC-000107')).toMatchObject({
        severity: 'critical',
        type: 'equipment_fault',
        form: 'filled',
        big: true,
        pulse: true,
        tag: 'CT-01',
        selected: false,
      });
    });

    it('stands at the top of the tower: the roof plus the class’s height', () => {
      const beacon = byCode(run(all), 'INC-000107');
      const [x, z] = groundOf(all, 'id-INC-000107');

      expect(beacon.position[1]).toBe(ROOF_M + TOWER_HEIGHT_M);
      expect(beacon.position[0]).toBeCloseTo(x, 9);
      expect(beacon.position[2]).toBeCloseTo(z, 9);
      // Frame 04 draws `[161, -48]` east and −north: the tower's place.
      expect(beacon.position[0]).toBeCloseTo(161, 1);
      expect(beacon.position[2]).toBeCloseTo(-48, 1);
    });

    it('leaves the other eight as they were', () => {
      const without = run(FRAME_01);
      const withIt = run(all).filter((beacon) => beacon.code !== 'INC-000107');

      expect(withIt).toEqual(without);
    });

    it('takes the asset’s top from the caller when it knows better, e.g. the loaded model', () => {
      const beacon = byCode(run(all, { assetTopM: () => 20.8 }), 'INC-000107');

      expect(beacon.position[1]).toBe(20.8);
    });

    it('falls back to the catalogue when the caller has no answer for that asset', () => {
      const beacon = byCode(run(all, { assetTopM: () => undefined }), 'INC-000107');

      expect(beacon.position[1]).toBe(ROOF_M + TOWER_HEIGHT_M);
    });

    it('asks the caller about the incident’s own asset', () => {
      const assetTopM = vi.fn<(asset: Asset) => number | undefined>(() => 7);

      run(all, { assetTopM });

      expect(assetTopM).toHaveBeenCalledExactlyOnceWith(CT01);
    });

    it('does not pulse once acknowledged, and is still larger and tagged', () => {
      const acknowledged = { ...TELEMETRY, status: 'acknowledged' as const };

      expect(byCode(run([acknowledged]), 'INC-000107')).toMatchObject({
        form: 'hollow',
        big: true,
        pulse: false,
        tag: 'CT-01',
      });
    });
  });

  describe('an asset the catalogue does not hold', () => {
    it('is no asset: no tag, and the position rule gives the height', () => {
      const orphan = incident(
        'INC-000200',
        'equipment_fault',
        'critical',
        'open',
        'BLD-DC',
        [170, 30],
        {
          assetId: 'asset-not-loaded-yet',
        },
      );

      expect(run([orphan])[0]).toMatchObject({
        tag: null,
        position: [expect.any(Number), ROOF_M, expect.any(Number)],
      });
    });

    it('is the same for a missing, null or empty asset id', () => {
      const base = incident('INC-000201', 'crowding', 'low', 'open', 'GATE-MAIN', [0, -248]);
      // An API from before `incident.asset_id` never sends the field (the contract type makes it optional).
      const missing: Incident = { ...base };
      delete missing.assetId;

      for (const subject of [missing, { ...base, assetId: null }, { ...base, assetId: '' }]) {
        expect(run([subject])[0]).toMatchObject({ tag: null });
      }
    });
  });

  describe('the roof', () => {
    it('is the height the shell is drawn at, the default one when the zone has none', () => {
      const bare = incident('INC-000300', 'injury', 'medium', 'open', 'BLD-NOHEIGHT', [-200, -150]);

      expect(run([bare])[0]?.position[1]).toBe(DEFAULT_BUILDING_HEIGHT_M);
    });

    it('is 0 for an incident whose zone the console does not hold', () => {
      const lost = incident(
        'INC-000301',
        'injury',
        'medium',
        'open',
        'ZONE-NOT-LOADED',
        [170, 212],
      );

      expect(run([lost])[0]?.position[1]).toBe(0);
    });

    it('is 0 for a zone that is not a building, even over its middle', () => {
      const parked = incident(
        'INC-000302',
        'blocked_access',
        'low',
        'open',
        'PRK-EAST',
        [185, 140],
      );

      expect(run([parked])[0]?.position[1]).toBe(0);
    });

    it('is tested at the incident’s own position, not the one the fan-out moved it to', () => {
      // One metre inside the Science Lab footprint's west edge. Three incidents share the point, so the ring
      // (radius 4.4 m) puts two of them west and east of it, and one of them past the footprint's edge.
      const at: [number, number] = [134, 212];
      const three = ['A', 'B', 'C'].map((suffix) =>
        incident(`INC-00040${suffix}`, 'fire_alarm', 'high', 'open', 'BLD-LAB', at),
      );

      const beacons = run(three);
      const xs = beacons.map((beacon) => beacon.position[0]);

      expect(new Set(xs).size).toBeGreaterThan(1);
      expect(beacons.map((beacon) => beacon.position[1])).toEqual([16, 16, 16]);
    });
  });

  describe('a resolved incident', () => {
    const resolved = incident(
      'INC-000500',
      'fire_alarm',
      'critical',
      'resolved',
      'BLD-LAB',
      [170, 212],
    );

    it('is not drawn unless it is selected', () => {
      expect(run([...FRAME_01, resolved])).toHaveLength(8);
      expect(run([...FRAME_01, resolved], { selectedId: 'id-INC-000104' })).toHaveLength(8);
    });

    it('is drawn while selected, neutral: not larger and not pulsing whatever its severity', () => {
      const beacons = run([...FRAME_01, resolved], { selectedId: resolved.id });

      expect(beacons).toHaveLength(9);
      expect(byCode(beacons, 'INC-000500')).toMatchObject({
        form: 'resolved',
        severity: 'critical',
        big: false,
        pulse: false,
        selected: true,
        position: [expect.any(Number), 16, expect.any(Number)],
      });
    });

    it('is spread with the others on the map’s ring, as the map spreads it', () => {
      const twin = incident('INC-000501', 'fire_alarm', 'high', 'open', 'BLD-LAB', [170, 212]);
      const all = [resolved, twin];

      const beacons = run(all, { selectedId: resolved.id });

      for (const beacon of beacons) {
        const [x, z] = groundOf(all, beacon.id);
        expect(beacon.position[0]).toBeCloseTo(x, 9);
        expect(beacon.position[2]).toBeCloseTo(z, 9);
      }
    });
  });

  describe('selection', () => {
    it('marks only the selected incident', () => {
      const beacons = run(FRAME_01, { selectedId: 'id-INC-000104' });

      expect(beacons.filter((beacon) => beacon.selected).map((beacon) => beacon.code)).toEqual([
        'INC-000104',
      ]);
    });

    it('draws nothing extra for an id that is not in the list', () => {
      const beacons = run(FRAME_01, { selectedId: 'id-gone' });

      expect(beacons).toHaveLength(8);
      expect(beacons.some((beacon) => beacon.selected)).toBe(false);
    });
  });

  describe('where several incidents share a point', () => {
    it('spreads them as the map does, and leaves a lone incident where it is', () => {
      const a = incident('INC-000600', 'crowding', 'low', 'open', 'GATE-MAIN', [0, -248]);
      const b = incident('INC-000601', 'blocked_access', 'low', 'open', 'GATE-MAIN', [0, -248]);
      const alone = incident('INC-000602', 'crowding', 'low', 'open', 'GATE-MAIN', [30, -240]);
      const all = [a, b, alone];

      const beacons = run(all);

      for (const beacon of beacons) {
        const [x, z] = groundOf(all, beacon.id);
        expect(beacon.position[0]).toBeCloseTo(x, 9);
        expect(beacon.position[2]).toBeCloseTo(z, 9);
      }
      const [first, second] = [byCode(beacons, 'INC-000600'), byCode(beacons, 'INC-000601')];
      expect(
        Math.hypot(first.position[0] - second.position[0], first.position[2] - second.position[2]),
      ).toBeGreaterThan(4);
      const [lonelyX, lonelyZ] = frame.toLocal(alone.position);
      expect(byCode(beacons, 'INC-000602').position[0]).toBeCloseTo(lonelyX, 9);
      expect(byCode(beacons, 'INC-000602').position[2]).toBeCloseTo(lonelyZ, 9);
    });
  });

  describe('a type this console does not know', () => {
    it('reads as the generic type, so the beacon still has a glyph', () => {
      const newer = incident('INC-000700', 'crowding', 'low', 'open', 'GATE-MAIN', [0, -248], {
        // The type says this cannot happen; a newer API can send it (rolling deploys, ADR-0021).
        type: 'gas_leak_v2' as string as IncidentType,
      });

      expect(run([newer])[0]?.type).toBe(UNKNOWN_TYPE_IMAGE);
    });
  });

  describe('the list', () => {
    it('is ordered by code, whatever the order the incidents come in', () => {
      const reversed = [...FRAME_01].reverse();

      expect(run(reversed).map((beacon) => beacon.code)).toEqual(
        run(FRAME_01).map((beacon) => beacon.code),
      );
    });

    it('does not change order when an incident is acknowledged', () => {
      const before = run(FRAME_01).map((beacon) => beacon.code);
      const acknowledged = FRAME_01.map((i) =>
        i.code === 'INC-000106' ? { ...i, status: 'acknowledged' as const } : i,
      );

      expect(run(acknowledged).map((beacon) => beacon.code)).toEqual(before);
    });

    it('is empty for no incidents', () => {
      expect(run([])).toEqual([]);
    });

    it('changes nothing in its arguments', () => {
      const all = [...FRAME_01, TELEMETRY];
      const snapshot = structuredClone({ all, assets: [CT01], zones: ZONES });

      run(all, { selectedId: 'id-INC-000104' });

      expect({ all, assets: [CT01], zones: ZONES }).toEqual(snapshot);
    });
  });
});

// V2-16.8: the cross-cutting checklist's "No second source of truth": the beacons are the 2D map's markers, not a set of
// their own. Both are `isActive(incident) || id === selectedId`; this says so by comparing what each one draws.
describe('the same set as the 2D map', () => {
  /** The ids the 2D map draws: the clustered set and the selected one. */
  const mapIds = (all: readonly Incident[], selectedId: string | null): string[] => {
    const { rest, selected } = incidentFeatures(all, selectedId);
    return [...rest.features, ...selected.features].map((feature) => feature.properties.id).sort();
  };
  const beaconIds = (all: readonly Incident[], selectedId: string | null): string[] =>
    run(all, { selectedId })
      .map((beacon) => beacon.id)
      .sort();

  const RESOLVED = incident('INC-000099', 'crowding', 'low', 'resolved', 'GATE-MAIN', [0, -248]);
  // A type a newer API may serve: it draws the unknown glyph on both.
  const FUTURE = incident('INC-000098', 'crowding', 'high', 'open', 'GATE-MAIN', [0, -248], {
    type: 'a_type_from_the_future' as string as IncidentType,
  });
  const MIXED = [...FRAME_01, TELEMETRY, RESOLVED, FUTURE];

  it('draws the active incidents of frame 01 and frame 04 on both, and not a resolved one', () => {
    const ids = beaconIds(MIXED, null);

    expect(ids).toEqual(mapIds(MIXED, null));
    expect(ids).toContain('id-INC-000107');
    expect(ids).not.toContain(RESOLVED.id);
  });

  it('draws a type the console does not know on both', () => {
    expect(beaconIds(MIXED, null)).toContain(FUTURE.id);
    expect(mapIds(MIXED, null)).toContain(FUTURE.id);
  });

  it('draws the selected incident on both even when it is resolved', () => {
    const ids = beaconIds(MIXED, RESOLVED.id);

    expect(ids).toEqual(mapIds(MIXED, RESOLVED.id));
    expect(ids).toContain(RESOLVED.id);
  });

  it('draws a selected active incident once on both', () => {
    const selected = 'id-INC-000104';

    expect(beaconIds(MIXED, selected)).toEqual(mapIds(MIXED, selected));
    expect(beaconIds(MIXED, selected).filter((id) => id === selected)).toHaveLength(1);
  });

  it('is the same set for the same incidents in another order', () => {
    const reversed = [...MIXED].reverse();

    expect(beaconIds(reversed, null)).toEqual(beaconIds(MIXED, null));
    expect(mapIds(reversed, null)).toEqual(mapIds(MIXED, null));
  });

  it('follows a status change on both: an acknowledged incident stays, a resolved one goes', () => {
    const acknowledged = MIXED.map((i) =>
      i.id === 'id-INC-000110' ? { ...i, status: 'acknowledged' as const } : i,
    );
    const resolved = MIXED.map((i) =>
      i.id === 'id-INC-000110' ? { ...i, status: 'resolved' as const } : i,
    );

    expect(beaconIds(acknowledged, null)).toEqual(mapIds(acknowledged, null));
    expect(beaconIds(acknowledged, null)).toContain('id-INC-000110');
    expect(beaconIds(resolved, null)).toEqual(mapIds(resolved, null));
    expect(beaconIds(resolved, null)).not.toContain('id-INC-000110');
  });

  it('is empty on both for no incidents', () => {
    expect(beaconIds([], null)).toEqual([]);
    expect(mapIds([], null)).toEqual([]);
  });
});
