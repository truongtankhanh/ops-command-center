import type { Asset, Camera, Incident, LngLat } from '@occ/contracts';
import { offsetM } from '../map/geo';
import { type RelatedSource, relatedOfAsset, relatedOfIncident } from './relatedItems';

const ASSET_POSITION: LngLat = [108.44, 11.95];

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset-1',
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
  position: ASSET_POSITION,
  elevationM: 0,
  headingDeg: 0,
  headline: [],
  ...overrides,
});

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc-1',
  code: 'INC-000001',
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: 'Water leak',
  description: null,
  zoneId: 'z1',
  position: ASSET_POSITION,
  source: 'telemetry',
  assetId: null,
  reportedAt: '2026-10-15T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** Sees nothing: no field of view, far from the asset. */
const camera = (code: string, zoneId: string, online = true): Camera => ({
  id: code,
  code,
  name: code,
  zoneId,
  position: [0, 0],
  online,
  fieldOfView: null,
});

/** 20 m south of the asset and facing north: the asset is in its 90°, 50 m sector. */
const seeing = (code: string, zoneId: string, online = true): Camera => ({
  ...camera(code, zoneId, online),
  position: offsetM(ASSET_POSITION, 0, -20),
  fieldOfView: { heading: 0, angle: 90, range: 50 },
});

const source = (parts: Partial<RelatedSource> = {}): RelatedSource => ({
  incidents: [],
  assets: [],
  cameras: [],
  ...parts,
});

const ids = (list: readonly { id: string }[]) => list.map((item) => item.id);
const codes = (list: readonly { code: string }[]) => list.map((item) => item.code);

describe('relatedOfIncident', () => {
  const self = incident({ id: 'inc-self' });

  describe('incidents', () => {
    it('are the others in its zone: not itself, not resolved, not another zone’s', () => {
      const related = relatedOfIncident(
        self,
        source({
          incidents: [
            self,
            incident({ id: 'open' }),
            incident({ id: 'acknowledged', status: 'acknowledged' }),
            incident({ id: 'resolved', status: 'resolved' }),
            incident({ id: 'elsewhere', zoneId: 'z2' }),
          ],
        }),
      );

      expect(ids(related.incidents).sort()).toEqual(['acknowledged', 'open']);
    });

    it('come in the feed’s order: most severe, then newest', () => {
      const related = relatedOfIncident(
        self,
        source({
          incidents: [
            incident({ id: 'high-old', severity: 'high', reportedAt: '2026-10-15T07:00:00.000Z' }),
            incident({ id: 'critical', severity: 'critical' }),
            incident({ id: 'high-new', severity: 'high', reportedAt: '2026-10-15T07:55:00.000Z' }),
          ],
        }),
      );

      expect(ids(related.incidents)).toEqual(['critical', 'high-new', 'high-old']);
    });
  });

  describe('device', () => {
    const tower = asset({ id: 'asset-1' });

    it('is the catalogue’s asset when the incident’s assetId resolves', () => {
      const related = relatedOfIncident(
        incident({ id: 'inc-self', assetId: 'asset-1' }),
        source({ assets: [asset({ id: 'asset-0', code: 'CT-00' }), tower] }),
      );

      expect(related.device).toBe(tower);
    });

    it.each([
      ['has no assetId', undefined],
      ['has a null assetId', null],
      ['has an assetId the catalogue does not hold', 'asset-gone'],
    ])('is null when the incident %s', (_name, assetId) => {
      const related = relatedOfIncident(
        { id: 'inc-self', zoneId: 'z1', assetId },
        source({ assets: [tower] }),
      );

      expect(related.device).toBeNull();
    });

    it('is null while the catalogue is empty', () => {
      const related = relatedOfIncident(incident({ assetId: 'asset-1' }), source());

      expect(related.device).toBeNull();
    });
  });

  describe('cameras', () => {
    it('are the zone’s, in the list’s order and all of them, with no device', () => {
      const related = relatedOfIncident(
        self,
        source({
          cameras: [
            camera('C', 'z1'),
            camera('A', 'z2'),
            camera('B', 'z1'),
            camera('D', 'z1'),
            camera('E', 'z1'),
          ],
        }),
      );

      expect(codes(related.cameras)).toEqual(['C', 'B', 'D', 'E']);
    });

    it('put the ones that see the device first, then the zone’s, offline last', () => {
      const related = relatedOfIncident(
        incident({ id: 'inc-self', assetId: 'asset-1' }),
        source({
          assets: [asset({ id: 'asset-1' })],
          cameras: [
            camera('A', 'z1'),
            camera('B', 'z1', false),
            seeing('S', 'z2'),
            camera('C', 'z1'),
          ],
        }),
      );

      expect(codes(related.cameras)).toEqual(['S', 'A', 'C', 'B']);
    });

    it('are the zone’s, as the Details tab shows them, when none sees the device', () => {
      const related = relatedOfIncident(
        incident({ id: 'inc-self', assetId: 'asset-1' }),
        source({
          assets: [asset({ id: 'asset-1' })],
          cameras: [camera('C', 'z1'), camera('A', 'z2'), camera('B', 'z1')],
        }),
      );

      expect(codes(related.cameras)).toEqual(['C', 'B']);
    });

    it('never include a camera of another zone that does not see the device', () => {
      const related = relatedOfIncident(
        incident({ id: 'inc-self', assetId: 'asset-1' }),
        source({
          assets: [asset({ id: 'asset-1' })],
          cameras: [camera('A', 'z2'), camera('B', 'z3')],
        }),
      );

      expect(related.cameras).toEqual([]);
    });
  });

  describe('count', () => {
    it('is the rows the tab lists: incidents, the device and the cameras', () => {
      const related = relatedOfIncident(
        incident({ id: 'inc-self', assetId: 'asset-1' }),
        source({
          incidents: [incident({ id: 'a' }), incident({ id: 'b' })],
          assets: [asset({ id: 'asset-1' })],
          cameras: [seeing('S', 'z1'), camera('A', 'z1'), camera('B', 'z1')],
        }),
      );

      expect(related.incidents).toHaveLength(2);
      expect(related.cameras).toHaveLength(3);
      expect(related.count).toBe(2 + 1 + 3);
    });

    it('leaves out a device that is not there', () => {
      const related = relatedOfIncident(self, source({ cameras: [camera('A', 'z1')] }));

      expect(related.count).toBe(1);
    });
  });

  it('is empty with nothing to list', () => {
    expect(relatedOfIncident(self, source())).toEqual({
      incidents: [],
      device: null,
      cameras: [],
      count: 0,
    });
  });

  it('does not change what it is given', () => {
    const incidents = Object.freeze([
      incident({ id: 'b', severity: 'low' }),
      incident({ id: 'a' }),
    ]);
    const assets = Object.freeze([asset({ id: 'asset-1' })]);
    const cameras = Object.freeze([camera('B', 'z1'), seeing('A', 'z1')]);

    const related = relatedOfIncident(
      incident({ id: 'inc-self', assetId: 'asset-1' }),
      source({ incidents, assets, cameras }),
    );

    expect(ids(incidents)).toEqual(['b', 'a']);
    expect(codes(cameras)).toEqual(['B', 'A']);
    expect(related.incidents).not.toBe(incidents);
  });
});

describe('relatedOfAsset', () => {
  const self = asset({ id: 'asset-1', code: 'CT-01' });

  describe('incidents', () => {
    it('are its own unresolved ones, most severe then newest', () => {
      const related = relatedOfAsset(
        self,
        source({
          incidents: [
            incident({ id: 'low', severity: 'low', assetId: 'asset-1' }),
            incident({ id: 'resolved', status: 'resolved', assetId: 'asset-1' }),
            incident({ id: 'other-asset', severity: 'critical', assetId: 'asset-2' }),
            incident({ id: 'no-asset', severity: 'critical', assetId: null }),
            incident({ id: 'critical', severity: 'critical', assetId: 'asset-1' }),
            incident({ id: 'acknowledged', status: 'acknowledged', assetId: 'asset-1' }),
          ],
        }),
      );

      expect(ids(related.incidents)).toEqual(['critical', 'acknowledged', 'low']);
    });
  });

  describe('cameras', () => {
    it('are the ones that see it, online first, then by code', () => {
      const related = relatedOfAsset(
        self,
        source({
          cameras: [
            seeing('S3', 'z9'),
            camera('A', 'z1'),
            seeing('S2', 'z1', false),
            seeing('S1', 'z1'),
          ],
        }),
      );

      expect(codes(related.cameras)).toEqual(['S1', 'S3', 'S2']);
    });

    it('leave out the zone’s cameras that do not see it', () => {
      const related = relatedOfAsset(
        self,
        source({ cameras: [camera('A', 'z1'), camera('B', 'z1', false)] }),
      );

      expect(related.cameras).toEqual([]);
    });
  });

  describe('assets', () => {
    it('are the others in the same zone, by code, and never itself', () => {
      const related = relatedOfAsset(
        self,
        source({
          assets: [
            asset({ id: 'zz', code: 'ZZ-02' }),
            self,
            asset({ id: 'other-zone', code: 'AA-00', zoneId: 'z2' }),
            asset({ id: 'aa', code: 'AA-01' }),
          ],
        }),
      );

      expect(codes(related.assets)).toEqual(['AA-01', 'ZZ-02']);
    });

    it('are none for an asset alone in its zone', () => {
      const related = relatedOfAsset(self, source({ assets: [self] }));

      expect(related.assets).toEqual([]);
    });
  });

  describe('count', () => {
    it('is the rows the tab lists: incidents, cameras and the assets beside it', () => {
      const related = relatedOfAsset(
        self,
        source({
          incidents: [incident({ id: 'a', assetId: 'asset-1' })],
          cameras: [seeing('S1', 'z1'), seeing('S2', 'z1')],
          assets: [self, asset({ id: 'aa', code: 'AA-01' }), asset({ id: 'bb', code: 'BB-01' })],
        }),
      );

      expect(related.count).toBe(1 + 2 + 2);
    });
  });

  it('is empty with nothing to list', () => {
    expect(relatedOfAsset(self, source())).toEqual({
      incidents: [],
      cameras: [],
      assets: [],
      count: 0,
    });
  });

  it('does not change what it is given', () => {
    const incidents = Object.freeze([
      incident({ id: 'b', severity: 'low', assetId: 'asset-1' }),
      incident({ id: 'a', assetId: 'asset-1' }),
    ]);
    const assets = Object.freeze([
      asset({ id: 'zz', code: 'ZZ-02' }),
      asset({ id: 'aa', code: 'AA-01' }),
    ]);
    const cameras = Object.freeze([seeing('B', 'z1', false), seeing('A', 'z1')]);

    const related = relatedOfAsset(self, source({ incidents, assets, cameras }));

    expect(ids(incidents)).toEqual(['b', 'a']);
    expect(codes(assets)).toEqual(['ZZ-02', 'AA-01']);
    expect(codes(cameras)).toEqual(['B', 'A']);
    expect(codes(related.cameras)).toEqual(['A', 'B']);
  });
});
