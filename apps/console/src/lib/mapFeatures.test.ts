import { type Camera, type Incident, INCIDENT_SEVERITIES, type LngLat } from '@occ/contracts';
import {
  cameraFeatures,
  cameraImageId,
  cameraViewFeatures,
  clusterCountImageId,
  clusterSeverityImageId,
  fanOut,
  incidentFeatures,
  incidentImageId,
  resolvedImageId,
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
