import type { Incident, LngLat, Zone } from '@occ/contracts';
import { offsetM } from './map/geo';
import { HIGHLIGHT_WIDTH_M, highlightRibbon, highlightZoneOf } from './twinHighlight';
import type { Mesh } from './twinGround';
import { makeFrame } from './twinScene';

const ANCHOR: LngLat = [108.4415, 11.953];
const frame = makeFrame(ANCHOR);
const at = (east: number, north: number): LngLat => offsetM(ANCHOR, east, north);

/** A closed 40 × 20 m ring, counter-clockwise on the map, 10 m east of the anchor. */
const ring = (): LngLat[] => [at(10, 0), at(50, 0), at(50, 20), at(10, 20), at(10, 0)];

const zone = (id: string, polygon: LngLat[] = ring()): Zone => ({
  id,
  code: id.toUpperCase(),
  name: id,
  kind: 'building',
  polygon,
  center: at(30, 10),
  heightM: 12,
});

const incident = (id: string, zoneId: string): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'fire_alarm',
  severity: 'high',
  status: 'open',
  title: 'Alarm',
  description: null,
  zoneId,
  position: at(30, 10),
  source: 'operator',
  reportedAt: '2026-10-20T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  assetId: null,
});

const closed = { reporting: false, reportZoneId: null, selectedIncidentId: null };

describe('highlightZoneOf', () => {
  const incidents = [incident('a', 'z1'), incident('b', 'z2')];

  it('is the selected incident’s zone', () => {
    expect(highlightZoneOf({ ...closed, selectedIncidentId: 'b', incidents })).toBe('z2');
  });

  it('is the report’s zone while the form is open, over the selected incident’s', () => {
    expect(
      highlightZoneOf({
        reporting: true,
        reportZoneId: 'z1',
        selectedIncidentId: 'b',
        incidents,
      }),
    ).toBe('z1');
  });

  it('is nothing while the form is open and no zone is chosen yet', () => {
    expect(
      highlightZoneOf({ reporting: true, reportZoneId: null, selectedIncidentId: 'b', incidents }),
    ).toBeNull();
  });

  it('ignores a report zone left over when the form is closed', () => {
    expect(
      highlightZoneOf({
        reporting: false,
        reportZoneId: 'z1',
        selectedIncidentId: null,
        incidents,
      }),
    ).toBeNull();
  });

  it('is nothing with no selection, with an unknown incident, and while the list loads', () => {
    expect(highlightZoneOf({ ...closed, incidents })).toBeNull();
    expect(highlightZoneOf({ ...closed, selectedIncidentId: 'gone', incidents })).toBeNull();
    expect(
      highlightZoneOf({ ...closed, selectedIncidentId: 'a', incidents: undefined }),
    ).toBeNull();
  });
});

describe('highlightRibbon', () => {
  const half = HIGHLIGHT_WIDTH_M / 2;

  /** The distance of a point on the ground from the outline of the 40 × 20 m rectangle (a metre east of x = 10). */
  const outsideBy = (x: number, z: number): number => {
    // In scene metres the rectangle spans x ∈ [10, 50] and z ∈ [−20, 0] (z = −north).
    const dx = Math.max(10 - x, 0, x - 50);
    const dz = Math.max(-20 - z, 0, z - 0);
    const outside = Math.hypot(dx, dz);
    if (outside > 0) return outside;
    return Math.min(x - 10, 50 - x, z + 20, 0 - z);
  };

  it('is a flat mesh of triangles along the zone’s ring', () => {
    const mesh = highlightRibbon([zone('z1')], frame, 'z1')!;

    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.positions.length % 3).toBe(0);
    for (let i = 1; i < mesh.positions.length; i += 3) expect(mesh.positions[i]).toBe(0);
  });

  it('stays within half the width of the ring, on either side', () => {
    const mesh = highlightRibbon([zone('z1')], frame, 'z1')!;

    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(outsideBy(mesh.positions[i]!, mesh.positions[i + 2]!)).toBeLessThanOrEqual(
        half + 0.01,
      );
    }
  });

  /** Whether the ground point (x, z) lies inside a triangle of the mesh. */
  const covers = (mesh: Mesh, x: number, z: number): boolean => {
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => mesh.indices[t + k]! * 3);
      const p = (i: number) => [mesh.positions[i]!, mesh.positions[i + 2]!] as const;
      const [ax, az] = p(a!);
      const [bx, bz] = p(b!);
      const [cx, cz] = p(c!);
      const side = (px: number, pz: number, qx: number, qz: number) =>
        (qx - px) * (z - pz) - (qz - pz) * (x - px);
      const signs = [side(ax, az, bx, bz), side(bx, bz, cx, cz), side(cx, cz, ax, az)];
      if (signs.every((v) => v >= -1e-9) || signs.every((v) => v <= 1e-9)) return true;
    }
    return false;
  };

  it('covers the middle of every side of the ring, the closing one included, and not the inside', () => {
    const mesh = highlightRibbon([zone('z1')], frame, 'z1', 1)!;

    // The sides of the 40 × 20 m rectangle: south (z = 0), east, north (z = −20) and the closing west one.
    expect(covers(mesh, 30, 0)).toBe(true);
    expect(covers(mesh, 50, -10)).toBe(true);
    expect(covers(mesh, 30, -20)).toBe(true);
    expect(covers(mesh, 10, -10)).toBe(true);
    expect(covers(mesh, 30, -10)).toBe(false);
  });

  it('is wider when asked for a wider ribbon', () => {
    const extent = (width: number) => {
      const mesh = highlightRibbon([zone('z1')], frame, 'z1', width)!;
      const xs = mesh.positions.filter((_, index) => index % 3 === 0);
      return Math.min(...xs);
    };

    expect(extent(6)).toBeLessThan(extent(2));
  });

  it('picks the zone by id among several', () => {
    const other = zone('z2', [at(100, 0), at(110, 0), at(110, 10), at(100, 10), at(100, 0)]);

    const mesh = highlightRibbon([zone('z1'), other], frame, 'z2')!;

    const xs = mesh.positions.filter((_, index) => index % 3 === 0);
    expect(Math.min(...xs)).toBeGreaterThan(90);
  });

  it('is null for a zone the list does not hold and for a ring that is not an area', () => {
    expect(highlightRibbon([zone('z1')], frame, 'nope')).toBeNull();
    expect(highlightRibbon([zone('z1', [])], frame, 'z1')).toBeNull();
    expect(highlightRibbon([zone('z1', [at(0, 0), at(5, 0)])], frame, 'z1')).toBeNull();
  });
});
