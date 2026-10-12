import { CAMERAS, INCIDENTS, REFERENCE_ZONE_CODES, SITE, ZONES, type ZoneSeed } from './campus';

/** A zone's rectangle in metres from the campus centre, as `rectangle()` draws it. */
const edges = ({ at: [east, north], size: [width, height] }: ZoneSeed) => ({
  west: east - width / 2,
  east: east + width / 2,
  south: north - height / 2,
  north: north + height / 2,
});

/** The boundary is a rectangle with rounded corners: inside means within the radius of the arc. */
const insideBoundary = (east: number, north: number): boolean => {
  const { west: w, east: e, south: s, north: n, radius } = SITE.boundary;
  if (east < w || east > e || north < s || north > n) return false;
  const arcEast = Math.min(Math.max(east, w + radius), e - radius);
  const arcNorth = Math.min(Math.max(north, s + radius), n - radius);
  return Math.hypot(east - arcEast, north - arcNorth) <= radius;
};

describe('demo campus seed', () => {
  const codes = ZONES.map((zone) => zone.code);

  it('has twenty zones with unique codes', () => {
    expect(ZONES).toHaveLength(20);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('keeps the first campus as the first nine zones, frozen', () => {
    expect([...REFERENCE_ZONE_CODES]).toEqual([
      'GATE-MAIN',
      'BLD-HUB',
      'BLD-LIB',
      'BLD-DC',
      'BLD-LHA',
      'BLD-STU',
      'PRK-WEST',
      'OUT-LAWN',
      'OUT-FIELD',
    ]);
    // Appending keeps insertion order, and a top-up never rewrites an existing zone's geometry.
    expect(codes.slice(0, REFERENCE_ZONE_CODES.length)).toEqual([...REFERENCE_ZONE_CODES]);
  });

  it('gives a use and a height to every building, and to nothing else', () => {
    for (const zone of ZONES) {
      if (zone.kind === 'building') {
        expect([zone.code, zone.use !== undefined]).toEqual([zone.code, true]);
        expect(zone.heightM).toBeGreaterThan(0);
      } else {
        expect([zone.code, zone.use, zone.heightM]).toEqual([zone.code, undefined, undefined]);
      }
    }
  });

  it('keeps every zone inside the site boundary', () => {
    for (const zone of ZONES) {
      const box = edges(zone);
      const corners = [
        [box.west, box.south],
        [box.east, box.south],
        [box.east, box.north],
        [box.west, box.north],
      ] as const;
      for (const [east, north] of corners) {
        expect([zone.code, insideBoundary(east, north)]).toEqual([zone.code, true]);
      }
    }
  });

  it('keeps zones from overlapping; touching edges is not overlap', () => {
    const overlapping: string[] = [];
    ZONES.forEach((a, index) => {
      for (const b of ZONES.slice(index + 1)) {
        const [boxA, boxB] = [edges(a), edges(b)];
        if (
          boxA.west < boxB.east &&
          boxB.west < boxA.east &&
          boxA.south < boxB.north &&
          boxB.south < boxA.north
        ) {
          overlapping.push(`${a.code} / ${b.code}`);
        }
      }
    });
    expect(overlapping).toEqual([]);
  });

  it('places every camera and incident in a seed zone', () => {
    for (const { code, zone } of CAMERAS) {
      expect([code, codes.includes(zone)]).toEqual([code, true]);
    }
    for (const { title, zone } of INCIDENTS) {
      expect([title, codes.includes(zone)]).toEqual([title, true]);
    }
  });

  it('has twenty cameras with unique codes, the twelve of the first campus first', () => {
    const cameraCodes = CAMERAS.map((camera) => camera.code);
    expect(CAMERAS).toHaveLength(20);
    expect(new Set(cameraCodes).size).toBe(cameraCodes.length);
    // Appending keeps insertion order, and the e2e top-up case tells the new cameras by position.
    expect(cameraCodes.slice(0, 12)).toEqual([
      'CAM-G01',
      'CAM-G02',
      'CAM-H01',
      'CAM-H02',
      'CAM-L01',
      'CAM-D01',
      'CAM-D02',
      'CAM-A01',
      'CAM-S01',
      'CAM-P01',
      'CAM-P02',
      'CAM-F01',
    ]);
  });

  it('gives every camera a field of view the camera table accepts', () => {
    for (const { code, name, fov } of CAMERAS) {
      // `camera.code` is varchar(32), `name` varchar(120), and `camera_field_of_view_check`.
      expect([code, code.length <= 32, name.length <= 120]).toEqual([code, true, true]);
      expect([code, fov.heading >= 0 && fov.heading < 360]).toEqual([code, true]);
      expect([code, fov.heading % 5]).toEqual([code, 0]);
      expect([code, fov.angle > 0 && fov.angle <= 360]).toEqual([code, true]);
      expect([code, fov.range > 0]).toEqual([code, true]);
    }
  });

  it('covers every building with a camera but three the design draws none for', () => {
    const covered = new Set(CAMERAS.map((camera) => camera.zone));
    const uncovered = ZONES.filter(
      (zone) => zone.kind === 'building' && !covered.has(zone.code),
    ).map((zone) => zone.code);
    expect(uncovered.sort()).toEqual(['BLD-ADMIN', 'BLD-SEC', 'BLD-SPORTS']);
  });
});
