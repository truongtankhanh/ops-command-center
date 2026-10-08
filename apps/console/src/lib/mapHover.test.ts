import type { IncidentSeverity } from '@occ/contracts';
import type { Geometry, Point } from 'geojson';
import { type HoverTarget, hoverTargetOf, isClickable, sameTarget } from './mapHover';
import { MAP_LAYERS } from './mapLayers';

const point = (lng = 108.44, lat = 11.95): Point => ({ type: 'Point', coordinates: [lng, lat] });

const incident = (id: string, lngLat: [number, number] = [108.44, 11.95]): HoverTarget => ({
  kind: 'incident',
  id,
  lngLat,
});

const cluster = (clusterId: number, count: number): HoverTarget => ({
  kind: 'cluster',
  clusterId,
  count,
  severity: 'high',
  lngLat: [108.44, 11.95],
});

describe('hoverTargetOf', () => {
  it('reads an incident from the incident layer', () => {
    expect(hoverTargetOf(MAP_LAYERS.incidents, { id: 'a' }, point())).toEqual({
      kind: 'incident',
      id: 'a',
      lngLat: [108.44, 11.95],
    });
  });

  it('reads the selected incident the same way', () => {
    expect(hoverTargetOf(MAP_LAYERS.selected, { id: 'a' }, point())).toEqual({
      kind: 'incident',
      id: 'a',
      lngLat: [108.44, 11.95],
    });
  });

  it('reads a camera', () => {
    expect(hoverTargetOf(MAP_LAYERS.cameras, { id: 'c1' }, point())).toEqual({
      kind: 'camera',
      id: 'c1',
      lngLat: [108.44, 11.95],
    });
  });

  it.each<[number, IncidentSeverity]>([
    [0, 'low'],
    [1, 'medium'],
    [2, 'high'],
    [3, 'critical'],
  ])("names a cluster's highest severity from rank %i", (sevRank, severity) => {
    expect(
      hoverTargetOf(MAP_LAYERS.clusters, { cluster_id: 7, point_count: 4, sevRank }, point()),
    ).toEqual({ kind: 'cluster', clusterId: 7, count: 4, severity, lngLat: [108.44, 11.95] });
  });

  it('ignores a layer it does not know', () => {
    expect(hoverTargetOf(MAP_LAYERS.zoneFill, { id: 'z1' }, point())).toBeNull();
  });

  it.each<[string, Geometry | null | undefined]>([
    ['no geometry', undefined],
    ['a null geometry', null],
    [
      'a line',
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    ],
    ['a point without coordinates', { type: 'Point', coordinates: [] }],
  ])('gives nothing without a point to anchor to: %s', (_, geometry) => {
    expect(hoverTargetOf(MAP_LAYERS.incidents, { id: 'a' }, geometry)).toBeNull();
  });

  it('gives nothing without properties', () => {
    expect(hoverTargetOf(MAP_LAYERS.incidents, undefined, point())).toBeNull();
  });

  it('needs a string id', () => {
    expect(hoverTargetOf(MAP_LAYERS.incidents, { id: 42 }, point())).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ['no cluster id', { point_count: 4, sevRank: 2 }],
    ['a count that is not a number', { cluster_id: 7, point_count: '4', sevRank: 2 }],
    ['a rank above critical', { cluster_id: 7, point_count: 4, sevRank: 4 }],
    ['a negative rank', { cluster_id: 7, point_count: 4, sevRank: -1 }],
  ])('gives nothing for a cluster with %s', (_, properties) => {
    expect(hoverTargetOf(MAP_LAYERS.clusters, properties, point())).toBeNull();
  });
});

describe('sameTarget', () => {
  it('treats two empty hovers as the same', () => {
    expect(sameTarget(null, null)).toBe(true);
  });

  it('keeps an incident while its id holds, wherever it is drawn', () => {
    expect(sameTarget(incident('a', [108.44, 11.95]), incident('a', [108.45, 11.96]))).toBe(true);
  });

  it('keeps a cluster while its id and size hold', () => {
    expect(sameTarget(cluster(7, 4), cluster(7, 4))).toBe(true);
  });

  it('sees a change from nothing to something', () => {
    expect(sameTarget(null, incident('a'))).toBe(false);
    expect(sameTarget(incident('a'), null)).toBe(false);
  });

  it('tells two incidents apart', () => {
    expect(sameTarget(incident('a'), incident('b'))).toBe(false);
  });

  it('tells an incident from a camera with the same id', () => {
    const camera: HoverTarget = { kind: 'camera', id: 'a', lngLat: [108.44, 11.95] };
    expect(sameTarget(incident('a'), camera)).toBe(false);
  });

  it('sees a regrouped cluster as new', () => {
    expect(sameTarget(cluster(7, 4), cluster(7, 5))).toBe(false);
  });
});

describe('isClickable', () => {
  it.each([MAP_LAYERS.selected, MAP_LAYERS.incidents, MAP_LAYERS.clusters, MAP_LAYERS.cameras])(
    'acts on %s',
    (layer) => {
      expect(isClickable(layer)).toBe(true);
    },
  );

  it.each([MAP_LAYERS.clusterCount, MAP_LAYERS.zoneFill])('does nothing on %s', (layer) => {
    expect(isClickable(layer)).toBe(false);
  });
});
