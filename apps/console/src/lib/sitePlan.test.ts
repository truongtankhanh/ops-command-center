import type { LngLat, SitePlan, Zone } from '@occ/contracts';
import { offsetM } from './geo';
import { siteBounds, siteFeatures } from './sitePlan';

const ANCHOR: LngLat = [108.4415, 11.953];

/** A point `east` / `north` metres from the anchor. */
const at = (east: number, north: number): LngLat => offsetM(ANCHOR, east, north);

/** A closed ring around a box given in metres from the anchor, as the seed builds zones. */
const box = (west: number, east: number, south: number, north: number): LngLat[] => [
  at(west, south),
  at(east, south),
  at(east, north),
  at(west, north),
  at(west, south),
];

const zone = (kind: Zone['kind'], polygon: LngLat[], id = kind): Zone => ({
  id,
  code: id.toUpperCase(),
  name: id,
  kind,
  polygon,
  center: polygon[0]!,
});

const plan = (features: SitePlan['features']): SitePlan => ({
  id: 's1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: ANCHOR,
  features,
});

const BOUNDARY = box(-100, 100, -100, 100);
const ROAD: LngLat[] = [at(0, -300), at(0, 0)];
const SITE = plan([
  { part: 'boundary', geometry: { type: 'Polygon', coordinates: [BOUNDARY] } },
  { part: 'road', geometry: { type: 'LineString', coordinates: ROAD } },
]);

/** Within ~0.1 mm: the module offsets from each corner, the fixture from the anchor. */
function expectNear([lng, lat]: LngLat, [expectedLng, expectedLat]: LngLat) {
  expect(lng).toBeCloseTo(expectedLng, 9);
  expect(lat).toBeCloseTo(expectedLat, 9);
}

const partsOf = (siteZones: Zone[], site?: SitePlan) =>
  siteFeatures(site, siteZones).features.map((feature) => feature.properties.part);

describe('siteFeatures', () => {
  it('draws the served plan first, in its order and geometry as served', () => {
    const { features } = siteFeatures(SITE, []);

    expect(features).toEqual([
      {
        type: 'Feature',
        properties: { part: 'boundary' },
        geometry: { type: 'Polygon', coordinates: [BOUNDARY] },
      },
      {
        type: 'Feature',
        properties: { part: 'road' },
        geometry: { type: 'LineString', coordinates: ROAD },
      },
    ]);
  });

  it('draws only the parts derived from the zones without a site plan', () => {
    const zones = [zone('building', box(0, 40, 0, 40)), zone('outdoor', box(50, 90, 0, 40))];

    expect(partsOf(zones)).toEqual(['footprint']);
    expect(partsOf(zones, SITE)).toEqual(['boundary', 'road', 'footprint']);
  });

  it('insets a building footprint 8 m inside its zone', () => {
    const [footprint] = siteFeatures(undefined, [zone('building', box(0, 40, 0, 30))]).features;
    const ring = footprint!.geometry.coordinates[0] as LngLat[];

    // A closed ring from the south-west corner; the north-east corner is third.
    expect(ring).toHaveLength(5);
    expect(ring.at(-1)).toEqual(ring[0]);
    expectNear(ring[0]!, at(8, 8));
    expectNear(ring[2]!, at(32, 22));
  });

  it('draws no footprint in a building zone too small to inset', () => {
    expect(partsOf([zone('building', box(0, 14, 0, 40))])).toEqual([]);
  });

  it('runs parking rows 15 m apart around the middle, clear of the edges', () => {
    // 100 m tall: rows at −30, −15, 0, 15, 30 m from the middle; ±45 would be within 15 m of an edge.
    const rows = siteFeatures(undefined, [zone('parking', box(0, 60, 0, 100))]).features;

    expect(rows.map((row) => row.properties.part)).toEqual(Array(5).fill('parking-row'));
    const lats = rows.map((row) => (row.geometry.coordinates[0] as LngLat)[1]);
    lats.forEach((lat, i) => expect(lat).toBeCloseTo(at(0, 20 + 15 * i)[1], 9));
  });
});

describe('siteBounds', () => {
  it('frames the boundary and every zone, whichever reaches further', () => {
    const outside = zone('outdoor', box(150, 200, -20, 20));

    expect(siteBounds(SITE, [outside])).toEqual([at(-100, -100), at(200, 100)]);
  });

  it('frames only the boundary of the plan, not its roads', () => {
    // The road runs 300 m south, well outside the boundary.
    expect(siteBounds(SITE, [])).toEqual([at(-100, -100), at(100, 100)]);
  });

  it('frames the zones alone without a site plan', () => {
    expect(siteBounds(undefined, [zone('building', box(0, 40, 0, 30))])).toEqual([
      at(0, 0),
      at(40, 30),
    ]);
  });

  it('has nothing to frame without a plan or zones', () => {
    expect(siteBounds(undefined, [])).toBeNull();
  });
});
