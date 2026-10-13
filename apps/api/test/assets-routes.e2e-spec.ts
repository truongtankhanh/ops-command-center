import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type ApiError, type Asset, type AssetDetail, ROLES, type Zone } from '@occ/contracts';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AssetsService } from '../src/assets/assets.service';
import { validateEnv } from '../src/config/env.validation';
import { configureApp } from '../src/configure-app';
import { ASSETS } from '../src/database/seed/assets';
import { bearer, signToken } from './support/tokens';

type Row = Record<string, unknown>;

/** The keys the contract gives each shape: a column that is not in it must not reach a client. */
const ASSET_KEYS = [
  'class',
  'code',
  'elevationM',
  'headingDeg',
  'headline',
  'id',
  'name',
  'position',
  'zoneId',
];
const DETAIL_KEYS = [...ASSET_KEYS, 'points', 'rules'].sort();
const CLASS_KEYS = ['code', 'footprintM', 'id', 'modelUrl', 'name'];
const POINT_KEYS = [
  'enumValues',
  'expectedIntervalS',
  'headline',
  'key',
  'kind',
  'label',
  'max',
  'min',
  'unit',
];
const RULE_KEYS = [
  'clear',
  'comparator',
  'forS',
  'incidentType',
  'key',
  'limit',
  'name',
  'severity',
];

/** CT-01's twelve points in the order the detail serves them: headline 1 and 2, then by key. */
const CT_01_POINTS = [
  'fanSpeedRpm',
  'motorTempC',
  'fanSetpointRpm',
  'motorCurrentA',
  'pumpFlowM3h',
  'runHoursH',
  'running',
  'switchState',
  'valveOpenPct',
  'vibrationMms',
  'waterInTempC',
  'waterOutTempC',
];

/**
 * The catalogue's read routes through the real middleware and guard chain (ADR-0018, ADR-0011).
 * The suite boots `AppModule` with `configureApp` on the shared `_test` database, which applies the
 * migrations and seeds the demo campus, and does not rebuild the schema. The fixtures a case needs
 * and the seed does not hold (a model key, an override, a disabled rule) use a `zz_` class code or
 * a `ZZ-` asset code, which the seed never uses, and are deleted after each case, assets first:
 * they restrict the deletion of their class.
 */
describe('Assets routes (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let token: string;
  let fixtureZoneId: string;

  const sweep = async () => {
    // An override cascades with its asset; a class rule and the points cascade with their class.
    await db.query(`DELETE FROM "asset" WHERE "code" LIKE 'ZZ-%'`);
    await db.query(`DELETE FROM "asset_class" WHERE "code" LIKE 'zz\\_%'`);
  };

  /** Inserts one row, quoting every identifier (`"limit"` is a reserved word); returns its id. */
  const insert = async (table: string, row: Row): Promise<string> => {
    const columns = Object.keys(row);
    const rows: { id: string }[] = await db.query(
      `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')})
       VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING "id"`,
      Object.values(row),
    );
    return rows[0].id;
  };

  const addClass = (over: Row = {}) =>
    insert('asset_class', {
      code: 'zz_class',
      name: 'Test class',
      footprint_w_m: 1,
      footprint_d_m: 1,
      footprint_h_m: 1,
      ...over,
    });

  const addPoint = (classId: string, key: string, over: Row = {}) =>
    insert('telemetry_point', {
      asset_class_id: classId,
      key,
      label: `Label of ${key}`,
      unit: '°C',
      kind: 'number',
      min: 0,
      max: 150,
      expected_interval_s: 5,
      ...over,
    });

  const addAsset = (classId: string, code: string) =>
    insert('asset', {
      code,
      name: `Asset ${code}`,
      asset_class_id: classId,
      zone_id: fixtureZoneId,
      lng: 108.4,
      lat: 11.95,
      elevation_m: 0,
      heading_deg: 0,
    });

  /** A class rule, or an override when `asset_id` is given. */
  const addRule = (classId: string, name: string, over: Row = {}) =>
    insert('telemetry_rule', {
      asset_class_id: classId,
      name,
      key: 'motorTempC',
      comparator: 'above',
      limit: 85,
      clear: 80,
      for_s: 60,
      severity: 'critical',
      ...over,
    });

  const get = (path: string, withToken = token) =>
    request(app.getHttpServer()).get(path).set('Authorization', bearer(withToken));

  const detail = async (code: string): Promise<AssetDetail> =>
    (await get(`/api/assets/${code}`).expect(200)).body as AssetDetail;

  const ruleSummary = (asset: AssetDetail) =>
    asset.rules.map(({ name, limit }) => [name, limit] as const);

  beforeAll(async () => {
    assertTestDatabase(validateEnv(process.env).DB_NAME);
    token = await signToken();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    db = app.get(DataSource);

    const zones: { id: string }[] = await db.query(
      `SELECT "id" FROM "zone" ORDER BY "code" LIMIT 1`,
    );
    fixtureZoneId = zones[0].id;
    // A run that was killed halfway leaves rows behind.
    await sweep();
  });

  afterEach(async () => {
    await sweep();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('access', () => {
    it.each([...ROLES])('lets a %s read both routes', async (role) => {
      const roleToken = await signToken({ sub: `e2e-${role}`, name: `E2E ${role}`, roles: [role] });

      await get('/api/assets', roleToken).expect(200);
      await get('/api/assets/CT-01', roleToken).expect(200);
    });

    it('answers 401 without a token, on both routes', async () => {
      await request(app.getHttpServer()).get('/api/assets').expect(401);
      await request(app.getHttpServer()).get('/api/assets/CT-01').expect(401);
    });

    it('answers 403 to a token with no known role, before any 400 or 404', async () => {
      const cases: [string, string[] | null][] = [
        ['no realm_access', null],
        ['no role', []],
        ['an unknown role only', ['admin']],
      ];
      const paths = ['/api/assets', '/api/assets/CT-01', '/api/assets/XX-99', '/api/assets/ct-01'];

      for (const [label, roles] of cases) {
        const roleless = await signToken({ sub: 'e2e-roleless', roles });
        for (const path of paths) {
          const res = await get(path, roleless);
          expect([label, path, res.status]).toEqual([label, path, 403]);
          expect(res.body.message).toBe('No role grants access to this API');
        }
      }
    });

    it('has no route that writes: POST, PUT, PATCH and DELETE find nothing to run', async () => {
      const server = app.getHttpServer();
      for (const path of ['/api/assets', '/api/assets/CT-01']) {
        for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
          const res = await request(server)[verb](path).set('Authorization', bearer(token));
          // No handler: Nest answers 404 (or 405), never a 2xx and never a write.
          expect([verb, path, [404, 405].includes(res.status)]).toEqual([verb, path, true]);
        }
      }
    });
  });

  describe('GET /api/assets', () => {
    it('lists the seed assets by code, each in the contract shape and no more', async () => {
      const res = await get('/api/assets').expect(200);
      const assets = res.body as Asset[];

      const seedCodes = ASSETS.map((asset) => asset.code);
      const served = assets.map((asset) => asset.code).filter((code) => seedCodes.includes(code));
      // The seed's tags sort the same by code point and by the database's collation.
      expect(served).toEqual([...seedCodes].sort());
      expect(served).toHaveLength(31);

      for (const asset of assets) {
        expect([asset.code, Object.keys(asset).sort()]).toEqual([asset.code, ASSET_KEYS]);
        expect(Object.keys(asset.class).sort()).toEqual(CLASS_KEYS);
        for (const headline of asset.headline) {
          expect(Object.keys(headline).sort()).toEqual(POINT_KEYS);
        }
        // At most two headline points, in rank order.
        const ranks = asset.headline.map((point) => point.headline);
        expect(ranks.length).toBeLessThanOrEqual(2);
        expect(ranks).toEqual([...ranks].sort());
      }
    });

    it('gives CT-01 its class, zone, place and its two headline points', async () => {
      const zones = (await get('/api/zones').expect(200)).body as Zone[];
      const dataCenter = zones.find((zone) => zone.code === 'BLD-DC')!;

      const assets = (await get('/api/assets').expect(200)).body as Asset[];
      const tower = assets.find((asset) => asset.code === 'CT-01')!;

      expect(tower).toMatchObject({
        code: 'CT-01',
        name: 'Cooling tower 1',
        zoneId: dataCenter.id,
        elevationM: 14,
        headingDeg: 0,
        class: {
          code: 'cooling_tower',
          name: 'Cooling tower',
          // No class has a model file yet (V2-13); a class that has one is the fixture case below.
          modelUrl: null,
          footprintM: { width: 4, depth: 4, height: 5 },
        },
      });
      expect(tower.position).toHaveLength(2);
      expect(tower.headline.map((point) => [point.key, point.headline])).toEqual([
        ['fanSpeedRpm', 1],
        ['motorTempC', 2],
      ]);
    });
  });

  describe('GET /api/assets/:code', () => {
    it('gives CT-01 its twelve points, headline first, and its three rules', async () => {
      const tower = await detail('CT-01');

      expect(Object.keys(tower).sort()).toEqual(DETAIL_KEYS);
      expect(tower.points.map((point) => point.key)).toEqual(CT_01_POINTS);
      for (const point of tower.points) {
        expect(Object.keys(point).sort()).toEqual(POINT_KEYS);
      }
      // By name; each with the contract's eight fields, so no `id`, `assetId` or `enabled`.
      expect(ruleSummary(tower)).toEqual([
        ['High vibration', 7.1],
        ['Motor over-temperature', 85],
        ['Motor overcurrent', 24],
      ]);
      for (const rule of tower.rules) {
        expect(Object.keys(rule).sort()).toEqual(RULE_KEYS);
      }
    });

    it('agrees with the list on what the asset is', async () => {
      const list = (await get('/api/assets').expect(200)).body as Asset[];
      const fromList = list.find((asset) => asset.code === 'CT-01')!;
      const { points, rules, ...fromDetail } = await detail('CT-01');

      expect(points).toBeDefined();
      expect(rules).toBeDefined();
      expect(fromDetail).toEqual(fromList);
    });

    it('serves an asset of a class that has no rule', async () => {
      const sensor = await detail('ICS-DC');

      expect(sensor.class.code).toBe('indoor_climate');
      expect(sensor.rules).toEqual([]);
      expect(sensor.points.length).toBeGreaterThan(0);
    });

    it('answers 404 for an asset that does not exist', async () => {
      const res = await get('/api/assets/XX-99').expect(404);
      const error = res.body as ApiError;

      expect(error).toMatchObject({
        statusCode: 404,
        error: 'NOT_FOUND',
        message: 'Asset XX-99 was not found',
        path: '/api/assets/XX-99',
      });
    });

    it('answers 400 for a code that is not an asset tag, with the problem listed', async () => {
      for (const code of ['not%20a%20code', 'ct-01', 'CT-1', 'CT-0001X78']) {
        const res = await get(`/api/assets/${code}`);
        expect([code, res.status]).toEqual([code, 400]);
        expect(res.body).toMatchObject({ statusCode: 400, error: 'BAD_REQUEST' });
        expect(Array.isArray(res.body.message)).toBe(true);
      }
    });
  });

  describe('what the database holds that the seed does not', () => {
    it("serves a class's model file as a URL under /models/", async () => {
      const classId = await addClass({ model_key: 'zz-tower.glb' });
      await addAsset(classId, 'ZZ-T1');

      const asset = await detail('ZZ-T1');

      expect(asset.class.modelUrl).toBe('/models/zz-tower.glb');
      // A class with no point is not a class that was not loaded.
      expect(asset.points).toEqual([]);
      expect(asset.headline).toEqual([]);
      expect(asset.rules).toEqual([]);
    });

    it('orders points by headline rank then key, and rules by name', async () => {
      const classId = await addClass();
      await addPoint(classId, 'zeta');
      await addPoint(classId, 'alpha');
      await addPoint(classId, 'beta', { headline: 2 });
      await addPoint(classId, 'gamma', { headline: 1 });
      await addRule(classId, 'b rule', { key: 'alpha' });
      await addRule(classId, 'a rule', { key: 'alpha' });
      await addRule(classId, 'A rule', { key: 'alpha' });
      await addAsset(classId, 'ZZ-T1');

      const asset = await detail('ZZ-T1');

      expect(asset.points.map((point) => point.key)).toEqual(['gamma', 'beta', 'alpha', 'zeta']);
      expect(asset.headline.map((point) => point.key)).toEqual(['gamma', 'beta']);
      expect(asset.rules.map((rule) => rule.name)).toEqual(['A rule', 'a rule', 'b rule']);
    });

    it('replaces a class rule with the rule of the asset, and only for that asset', async () => {
      const classId = await addClass();
      await addPoint(classId, 'motorTempC');
      await addPoint(classId, 'vibrationMms');
      await addRule(classId, 'Motor over-temperature');
      await addRule(classId, 'High vibration', { key: 'vibrationMms', limit: 7.1, clear: 5 });
      const tunedId = await addAsset(classId, 'ZZ-T1');
      await addAsset(classId, 'ZZ-T2');
      await addRule(classId, 'Motor over-temperature', {
        asset_id: tunedId,
        limit: 95,
        clear: 90,
      });

      expect(ruleSummary(await detail('ZZ-T1'))).toEqual([
        ['High vibration', 7.1],
        ['Motor over-temperature', 95],
      ]);
      expect(ruleSummary(await detail('ZZ-T2'))).toEqual([
        ['High vibration', 7.1],
        ['Motor over-temperature', 85],
      ]);
    });

    it('leaves out a disabled rule', async () => {
      const classId = await addClass();
      await addPoint(classId, 'motorTempC');
      await addRule(classId, 'Motor over-temperature');
      await addRule(classId, 'Switched off', { enabled: false });
      await addAsset(classId, 'ZZ-T1');

      expect(ruleSummary(await detail('ZZ-T1'))).toEqual([['Motor over-temperature', 85]]);
    });

    it('turns a rule off for the asset whose own rule is disabled, and no other', async () => {
      const classId = await addClass();
      await addPoint(classId, 'motorTempC');
      await addRule(classId, 'Motor over-temperature');
      const silencedId = await addAsset(classId, 'ZZ-T1');
      await addAsset(classId, 'ZZ-T2');
      await addRule(classId, 'Motor over-temperature', { asset_id: silencedId, enabled: false });

      // The disabled rule of the asset replaced the class rule, so it does not alarm again.
      expect((await detail('ZZ-T1')).rules).toEqual([]);
      expect(ruleSummary(await detail('ZZ-T2'))).toEqual([['Motor over-temperature', 85]]);
    });
  });

  /**
   * The bulk read the telemetry bridge uses instead of `detail` per asset. It has no route, so the
   * cases go through the service of the booted app; the rules must come out as `detail` serves them.
   */
  describe('AssetsService.catalogue', () => {
    const catalogue = () => app.get(AssetsService).catalogue();
    const find = async (code: string) => (await catalogue()).find((asset) => asset.code === code)!;
    const summary = (rules: { name: string; limit: number }[]) =>
      rules.map(({ name, limit }) => [name, limit] as const);

    it('serves every seed asset by code, each with all the points of its class and its rules', async () => {
      const seedCodes = ASSETS.map((asset) => asset.code);
      const served = (await catalogue()).filter((asset) => seedCodes.includes(asset.code));

      expect(served.map((asset) => asset.code)).toEqual([...seedCodes].sort());

      const tower = served.find((asset) => asset.code === 'CT-01')!;
      expect(tower.points.map((point) => point.key)).toEqual(CT_01_POINTS);
      expect(summary(tower.rules)).toEqual([
        ['High vibration', 7.1],
        ['Motor over-temperature', 85],
        ['Motor overcurrent', 24],
      ]);
      expect(served.find((asset) => asset.code === 'ICS-DC')!.rules).toEqual([]);
    });

    it('agrees with the detail route on the rules of an asset', async () => {
      const fromCatalogue = summary((await find('CT-01')).rules);

      expect(fromCatalogue).toEqual(ruleSummary(await detail('CT-01')));
    });

    it('keeps the id of a rule and whose it is, which raising an incident needs', async () => {
      const { rules } = await find('CT-01');

      expect(rules).toHaveLength(3);
      for (const rule of rules) {
        expect(typeof rule.id).toBe('string');
        expect(rule.assetId).toBeNull();
        expect(rule.enabled).toBe(true);
      }
    });

    it('replaces a class rule with the rule of the asset, and only for that asset', async () => {
      const classId = await addClass();
      await addPoint(classId, 'motorTempC');
      await addRule(classId, 'Motor over-temperature');
      const tunedId = await addAsset(classId, 'ZZ-T1');
      await addAsset(classId, 'ZZ-T2');
      await addRule(classId, 'Motor over-temperature', {
        asset_id: tunedId,
        limit: 95,
        clear: 90,
      });

      expect(summary((await find('ZZ-T1')).rules)).toEqual([['Motor over-temperature', 95]]);
      expect(summary((await find('ZZ-T2')).rules)).toEqual([['Motor over-temperature', 85]]);
    });

    it('leaves out a disabled rule, and a disabled override silences its asset alone', async () => {
      const classId = await addClass();
      await addPoint(classId, 'motorTempC');
      await addRule(classId, 'Motor over-temperature');
      await addRule(classId, 'Switched off', { enabled: false });
      const silencedId = await addAsset(classId, 'ZZ-T1');
      await addAsset(classId, 'ZZ-T2');
      await addRule(classId, 'Motor over-temperature', { asset_id: silencedId, enabled: false });

      expect((await find('ZZ-T1')).rules).toEqual([]);
      expect(summary((await find('ZZ-T2')).rules)).toEqual([['Motor over-temperature', 85]]);
    });
  });
});

/** Like the other suites: never write to a database whose name does not end in `_test`. */
function assertTestDatabase(name: string): void {
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run against database "${name}": e2e needs a *_test database.`);
  }
}
