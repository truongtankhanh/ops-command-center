import {
  type Asset,
  type Camera,
  type Incident,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  type IncidentType,
  type LngLat,
} from '@occ/contracts';
import type { AssetState } from '../assets';
import {
  assetFeatures,
  assetImageId,
  assetLookOf,
  cameraFeatures,
  cameraImageId,
  cameraViewFeatures,
  clusterCountImageId,
  clusterSeverityImageId,
  fanOut,
  fanOutAssets,
  incidentFeatures,
  incidentImageId,
  type MarkerType,
  resolvedImageId,
  UNKNOWN_TYPE_IMAGE,
} from './mapFeatures';

const ANCHOR: LngLat = [108.4415, 11.953];

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'id',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'medium',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: ANCHOR,
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** Same equirectangular approximation as the module, in metres. */
function metresBetween([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const metresPerDegree = 111_320;
  const east = (lng2 - lng1) * metresPerDegree * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(east, (lat2 - lat1) * metresPerDegree);
}

/** A point `metres` east of the anchor. */
const eastOf = (metres: number): LngLat => [
  ANCHOR[0] + metres / (111_320 * Math.cos((ANCHOR[1] * Math.PI) / 180)),
  ANCHOR[1],
];

const at = (minute: number) => `2026-10-01T08:${String(minute).padStart(2, '0')}:00.000Z`;

describe('image ids', () => {
  it('names an incident image by severity, status and type', () => {
    expect(incidentImageId({ severity: 'critical', status: 'open', type: 'fire_alarm' })).toBe(
      'incident-critical-open-fire_alarm',
    );
    expect(incidentImageId({ severity: 'low', status: 'acknowledged', type: 'medical' })).toBe(
      'incident-low-acknowledged-medical',
    );
  });

  it('uses one resolved image per type, whatever the severity', () => {
    expect(incidentImageId({ severity: 'critical', status: 'resolved', type: 'crowding' })).toBe(
      resolvedImageId('crowding'),
    );
    expect(resolvedImageId('crowding')).toBe('incident-resolved-crowding');
  });

  // A newer API can send a type this build's contract lacks (ADR-0021, rolling deploys); the type
  // system cannot model it, hence the cast.
  it('names an unknown type by the generic images registered for it', () => {
    const type = 'not_in_contract' as IncidentType;
    expect(incidentImageId({ severity: 'high', status: 'open', type })).toBe(
      'incident-high-open-unknown',
    );
    expect(incidentImageId({ severity: 'high', status: 'resolved', type })).toBe(
      'incident-resolved-unknown',
    );
  });

  it('keeps the generic suffix apart from every contract type', () => {
    expect(INCIDENT_TYPES as readonly MarkerType[]).not.toContain(UNKNOWN_TYPE_IMAGE);
  });

  it('names camera images by state', () => {
    expect(cameraImageId(true)).toBe('camera-online');
    expect(cameraImageId(false)).toBe('camera-offline');
  });

  it('caps cluster count images at 9+', () => {
    expect(clusterCountImageId(3)).toBe('cluster-count-3');
    expect(clusterCountImageId(9)).toBe('cluster-count-9');
    expect(clusterCountImageId(10)).toBe('cluster-count-9+');
  });

  it('names a cluster badge image by severity', () => {
    expect(clusterSeverityImageId('critical')).toBe('cluster-severity-critical');
    expect(new Set(INCIDENT_SEVERITIES.map(clusterSeverityImageId)).size).toBe(4);
  });
});

describe('fanOut', () => {
  it('keeps the position of an incident with nobody near it', () => {
    const positions = fanOut([incident({ id: 'a' })]);

    expect(positions.get('a')).toEqual(ANCHOR);
  });

  it('leaves incidents more than one marker apart where they are', () => {
    const far = eastOf(10);
    const positions = fanOut([incident({ id: 'a' }), incident({ id: 'b', position: far })]);

    expect(positions.get('a')).toEqual(ANCHOR);
    expect(positions.get('b')).toEqual(far);
  });

  it('spreads incidents at the same spot, the first reported at north', () => {
    const positions = fanOut([
      incident({ id: 'later', reportedAt: at(5) }),
      incident({ id: 'first', reportedAt: at(1) }),
    ]);
    const first = positions.get('first')!;
    const later = positions.get('later')!;

    expect(first[0]).toBeCloseTo(ANCHOR[0], 9);
    expect(first[1]).toBeGreaterThan(ANCHOR[1]);
    expect(later[1]).toBeLessThan(ANCHOR[1]);
    expect(metresBetween(first, later)).toBeGreaterThanOrEqual(4.4);
  });

  it('groups incidents closer than one marker even when not identical', () => {
    const positions = fanOut([
      incident({ id: 'a', reportedAt: at(1) }),
      incident({ id: 'b', reportedAt: at(2), position: eastOf(1) }),
    ]);

    expect(metresBetween(positions.get('a')!, positions.get('b')!)).toBeGreaterThanOrEqual(4.4);
  });

  it('keeps every marker of a large group apart', () => {
    const group = Array.from({ length: 7 }, (_, i) => incident({ id: `i${i}`, reportedAt: at(i) }));
    const points = [...fanOut(group).values()];

    for (const [i, a] of points.entries()) {
      for (const b of points.slice(i + 1)) expect(metresBetween(a, b)).toBeGreaterThan(4);
    }
  });

  it('orders the ring by report time, then id, whatever the input order', () => {
    const list = [
      incident({ id: 'b', reportedAt: at(1) }),
      incident({ id: 'a', reportedAt: at(1) }),
      incident({ id: 'c', reportedAt: at(0) }),
    ];

    expect(fanOut([...list].reverse())).toEqual(fanOut(list));
  });
});

const asset = (overrides: Partial<Asset>): Asset => ({
  id: 'asset-id',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'z1',
  position: ANCHOR,
  elevationM: 0,
  headingDeg: 0,
  headline: [],
  ...overrides,
});

describe('asset image ids', () => {
  it('draws a fault in its state, nodata and offline alike, everything else as normal', () => {
    expect(assetLookOf('fault')).toBe('fault');
    expect(assetLookOf('nodata')).toBe('nodata');
    expect(assetLookOf('offline')).toBe('nodata');
    for (const state of ['running', 'standby', 'unknown'] as const) {
      expect(assetLookOf(state)).toBe('normal');
    }
  });

  it('names a fault by the severity of its incident, and the other looks by the look', () => {
    expect(assetImageId('normal', null)).toBe('asset-normal');
    expect(assetImageId('nodata', 'critical')).toBe('asset-nodata');
    expect(assetImageId('fault', 'critical')).toBe('asset-fault-critical');
    expect(new Set(INCIDENT_SEVERITIES.map((s) => assetImageId('fault', s))).size).toBe(4);
  });

  it('draws a fault with no known severity as medium rather than as a missing image', () => {
    expect(assetImageId('fault', null)).toBe('asset-fault-medium');
  });
});

describe('fanOutAssets', () => {
  it('keeps the position of an asset with nobody near it', () => {
    const positions = fanOutAssets([asset({ code: 'A' })]);

    expect(positions.get('A')).toEqual(ANCHOR);
  });

  it('leaves assets farther apart than a marker where they are', () => {
    const near = eastOf(1);
    const positions = fanOutAssets([asset({ code: 'A' }), asset({ code: 'B', position: near })]);

    expect(positions.get('A')).toEqual(ANCHOR);
    expect(positions.get('B')).toEqual(near);
  });

  it('spreads two assets on one point on a ring, the first code at north', () => {
    // PMP-S1 and ICS-STU: the pump is a box on the sensor's point (asset-classes.md).
    const positions = fanOutAssets([asset({ code: 'PMP-S1' }), asset({ code: 'ICS-STU' })]);
    const first = positions.get('ICS-STU')!;
    const second = positions.get('PMP-S1')!;

    expect(first[0]).toBeCloseTo(ANCHOR[0], 9);
    expect(first[1]).toBeGreaterThan(ANCHOR[1]);
    expect(second[1]).toBeLessThan(ANCHOR[1]);
    expect(metresBetween(first, second)).toBeGreaterThanOrEqual(4);
  });

  it('groups assets closer than the threshold even when not identical', () => {
    const positions = fanOutAssets([
      asset({ code: 'A' }),
      asset({ code: 'B', position: eastOf(0.4) }),
    ]);

    expect(metresBetween(positions.get('A')!, positions.get('B')!)).toBeGreaterThanOrEqual(4);
  });

  it('does not group assets just past the threshold', () => {
    const far = eastOf(0.6);
    const positions = fanOutAssets([asset({ code: 'A' }), asset({ code: 'B', position: far })]);

    expect(positions.get('B')).toEqual(far);
  });

  it('keeps every asset of a large group apart', () => {
    const group = Array.from({ length: 6 }, (_, i) => asset({ code: `A${i}` }));
    const points = [...fanOutAssets(group).values()];

    for (const [i, a] of points.entries()) {
      for (const b of points.slice(i + 1)) expect(metresBetween(a, b)).toBeGreaterThan(3.5);
    }
  });

  it('orders the ring by code whatever the input order', () => {
    const list = [asset({ code: 'B' }), asset({ code: 'A' }), asset({ code: 'C' })];

    expect(fanOutAssets([...list].reverse())).toEqual(fanOutAssets(list));
  });
});

describe('assetFeatures', () => {
  const states = (entries: [string, AssetState][]) => new Map(entries);

  it('draws one marker per asset at its own position, ordered by code', () => {
    const list = [
      asset({ id: 'b', code: 'B', position: eastOf(20) }),
      asset({ id: 'a', code: 'A', position: eastOf(10) }),
    ];

    const { features } = assetFeatures(list, states([]), []);

    expect(features.map((f) => f.properties.code)).toEqual(['A', 'B']);
    expect(features[0]!.geometry.coordinates).toEqual(eastOf(10));
    expect(features[1]!.geometry.coordinates).toEqual(eastOf(20));
  });

  // GEN-01 stands 3 m outside its zone (asset-classes.md): nothing clips an asset to its zone.
  it('draws an asset where it stands, outside its zone included', () => {
    const outside = eastOf(3);

    const { features } = assetFeatures(
      [asset({ code: 'GEN-01', position: outside })],
      states([]),
      [],
    );

    expect(features[0]!.geometry.coordinates).toEqual(outside);
  });

  it('describes each asset for the layer by its state', () => {
    const list = [
      asset({ id: 'a', code: 'A', position: eastOf(10) }),
      asset({ id: 'b', code: 'B', position: eastOf(20) }),
      asset({ id: 'c', code: 'C', position: eastOf(30) }),
    ];

    const { features } = assetFeatures(
      list,
      states([
        ['A', 'running'],
        ['B', 'offline'],
        ['C', 'standby'],
      ]),
      [],
    );

    expect(features.map((f) => f.properties.image)).toEqual([
      'asset-normal',
      'asset-nodata',
      'asset-normal',
    ]);
    expect(features[0]!.properties).toMatchObject({
      code: 'A',
      name: 'Cooling tower 1',
      state: 'running',
    });
  });

  it('draws a fault in the severity of the incident that raised it', () => {
    const faulty = asset({ id: 'a-1', code: 'CT-01' });
    const incidents = [
      incident({ id: 'low', assetId: 'a-1', severity: 'low' }),
      incident({ id: 'high', assetId: 'a-1', severity: 'high' }),
      incident({ id: 'other', assetId: 'someone-else', severity: 'critical' }),
    ];

    const { features } = assetFeatures([faulty], states([['CT-01', 'fault']]), incidents);

    expect(features[0]!.properties).toMatchObject({
      state: 'fault',
      severity: 'high',
      image: 'asset-fault-high',
    });
  });

  it('carries no severity unless the asset is a fault', () => {
    const { features } = assetFeatures(
      [asset({ id: 'a-1', code: 'CT-01' })],
      states([['CT-01', 'running']]),
      [incident({ assetId: 'a-1', severity: 'critical' })],
    );

    expect(features[0]!.properties.severity).toBeNull();
  });

  it('draws an asset the states do not know as normal', () => {
    const { features } = assetFeatures([asset({ code: 'NEW-01' })], states([]), []);

    expect(features[0]!.properties).toMatchObject({ state: 'unknown', image: 'asset-normal' });
  });

  it('gives the same list for the same facts, so an unchanged tick can be told apart', () => {
    const list = [asset({ code: 'A' }), asset({ code: 'B' })];
    const known = states([['A', 'running']]);

    expect(JSON.stringify(assetFeatures(list, known, []))).toBe(
      JSON.stringify(assetFeatures([...list].reverse(), new Map(known), [])),
    );
  });
});

describe('incidentFeatures', () => {
  const coordinatesById = (features: ReturnType<typeof incidentFeatures>) =>
    new Map(
      [...features.rest.features, ...features.selected.features].map((f) => [
        f.properties.id,
        f.geometry.coordinates,
      ]),
    );

  it('draws active incidents and the selected one even when resolved', () => {
    const list = [
      incident({ id: 'open' }),
      incident({ id: 'acknowledged', status: 'acknowledged', position: eastOf(20) }),
      incident({ id: 'resolved', status: 'resolved', position: eastOf(40) }),
      incident({ id: 'resolved-selected', status: 'resolved', position: eastOf(60) }),
    ];

    const { rest, selected } = incidentFeatures(list, 'resolved-selected');

    expect(rest.features.map((f) => f.properties.id)).toEqual(['open', 'acknowledged']);
    expect(selected.features.map((f) => f.properties.id)).toEqual(['resolved-selected']);
    expect(selected.features[0]!.properties.image).toBe('incident-resolved-intrusion');
  });

  it('keeps the selected incident out of the clustered set', () => {
    const { rest, selected } = incidentFeatures(
      [incident({ id: 'a' }), incident({ id: 'b', position: eastOf(20) })],
      'b',
    );

    expect(rest.features.map((f) => f.properties.id)).toEqual(['a']);
    expect(selected.features.map((f) => f.properties.id)).toEqual(['b']);
  });

  it('draws nothing selected when the selection is not in the list', () => {
    expect(incidentFeatures([incident({ id: 'a' })], 'gone').selected.features).toEqual([]);
  });

  it('describes each incident for the layers', () => {
    const { rest } = incidentFeatures(
      [
        incident({ id: 'c', code: 'INC-000003', severity: 'critical', type: 'fire_alarm' }),
        incident({
          id: 'h',
          severity: 'high',
          status: 'acknowledged',
          position: eastOf(20),
        }),
      ],
      null,
    );
    const [critical, high] = rest.features;

    expect(critical!.properties).toEqual({
      id: 'c',
      code: 'INC-000003',
      image: 'incident-critical-open-fire_alarm',
      sevRank: 3,
      sortKey: 7,
      pulse: true,
    });
    expect(high!.properties).toMatchObject({ sevRank: 2, sortKey: 4, pulse: false });
  });

  it('pulses only while an open critical incident is drawn', () => {
    expect(incidentFeatures([incident({ severity: 'critical' })], null).pulsing).toBe(true);
    expect(
      incidentFeatures([incident({ severity: 'critical', status: 'acknowledged' })], null).pulsing,
    ).toBe(false);
    expect(
      incidentFeatures([incident({ severity: 'critical', status: 'resolved' })], null).pulsing,
    ).toBe(false);
    expect(incidentFeatures([incident({ severity: 'high' })], null).pulsing).toBe(false);
  });

  it('does not move markers when a neighbour is acknowledged or selected', () => {
    const list = [
      incident({ id: 'a', reportedAt: at(1) }),
      incident({ id: 'b', reportedAt: at(2) }),
      incident({ id: 'c', reportedAt: at(3) }),
    ];
    const before = coordinatesById(incidentFeatures(list, null));
    const after = coordinatesById(
      incidentFeatures(
        list.map((i) => (i.id === 'b' ? { ...i, status: 'acknowledged' as const } : i)),
        'b',
      ),
    );

    expect(after).toEqual(before);
  });
});

describe('cameraFeatures', () => {
  it('places each camera with its state image', () => {
    const cameras: Camera[] = [
      {
        id: 'c1',
        code: 'CAM-1',
        name: 'Gate',
        zoneId: 'z1',
        position: ANCHOR,
        online: true,
        fieldOfView: null,
      },
      {
        id: 'c2',
        code: 'CAM-2',
        name: 'Lab',
        zoneId: 'z1',
        position: eastOf(5),
        online: false,
        fieldOfView: null,
      },
    ];

    expect(cameraFeatures(cameras).features).toEqual([
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: ANCHOR },
        properties: { id: 'c1', image: 'camera-online' },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: eastOf(5) },
        properties: { id: 'c2', image: 'camera-offline' },
      },
    ]);
  });
});

describe('cameraViewFeatures', () => {
  const camera = (overrides: Partial<Camera> = {}): Camera => ({
    id: 'c1',
    code: 'CAM-1',
    name: 'Gate',
    zoneId: 'z1',
    position: ANCHOR,
    online: true,
    fieldOfView: { heading: 90, angle: 90, range: 40 },
    ...overrides,
  });

  const ringOf = (cameras: Camera[]): LngLat[] =>
    cameraViewFeatures(cameras).features[0]!.geometry.coordinates[0] as LngLat[];

  it('draws a view only for a camera whose field of view is known', () => {
    // An API from before IMP-24 sends no `fieldOfView` key at all.
    const legacy: Partial<Camera> = camera({ id: 'c3' });
    delete legacy.fieldOfView;

    const views = cameraViewFeatures([
      camera({ id: 'c1' }),
      camera({ id: 'c2', fieldOfView: null }),
      legacy as Camera,
    ]);

    expect(views.features.map((view) => view.properties.id)).toEqual(['c1']);
  });

  it('tells online and offline cameras apart', () => {
    const views = cameraViewFeatures([camera({ id: 'c1' }), camera({ id: 'c2', online: false })]);

    expect(views.features.map((view) => view.properties)).toEqual([
      { id: 'c1', online: true },
      { id: 'c2', online: false },
    ]);
  });

  it('draws a sector from the camera, range metres long, closed at the apex', () => {
    const ring = ringOf([camera()]);

    // Apex, 18 five-degree segments (19 arc points), back to the apex.
    expect(ring).toHaveLength(21);
    expect(ring[0]).toEqual(ANCHOR);
    expect(ring.at(-1)).toEqual(ANCHOR);
    for (const point of ring.slice(1, -1)) expect(metresBetween(ANCHOR, point)).toBeCloseTo(40, 1);
  });

  it('centres the arc on the heading, clockwise from north', () => {
    const ring = ringOf([camera({ fieldOfView: { heading: 90, angle: 90, range: 40 } })]);
    const [first, middle, last] = [ring[1]!, ring[10]!, ring.at(-2)!];

    // Heading 90° is due east; the arc runs from 45° (north-east) to 135° (south-east).
    expect(middle[1]).toBeCloseTo(ANCHOR[1], 9);
    expect(middle[0]).toBeGreaterThan(ANCHOR[0]);
    expect(first[1]).toBeGreaterThan(ANCHOR[1]);
    expect(last[1]).toBeLessThan(ANCHOR[1]);
  });

  it('draws a 360° view as a closed circle without the apex', () => {
    const ring = ringOf([camera({ fieldOfView: { heading: 0, angle: 360, range: 10 } })]);

    // 72 five-degree segments; the ring closes exactly on its first point.
    expect(ring).toHaveLength(73);
    expect(ring.at(-1)).toEqual(ring[0]);
    for (const point of ring) expect(metresBetween(ANCHOR, point)).toBeCloseTo(10, 1);
  });
});
