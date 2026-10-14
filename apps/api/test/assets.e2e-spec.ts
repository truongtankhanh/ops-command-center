import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { categoryOf, INCIDENT_TYPES } from '@occ/contracts';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validateEnv } from '../src/config/env.validation';
import { ASSET_CLASSES } from '../src/database/seed/asset-catalogue';
import { ASSETS } from '../src/database/seed/assets';
import { SeedService } from '../src/database/seed/seed.service';

type Row = Record<string, unknown>;

/**
 * The equipment catalogue's constraints, asserted through raw SQL as the zone height case is: the
 * database is the only enforcement (ADR-0018), so the refusals are checked there, by the name
 * Postgres reports. The routes over the catalogue are `assets-routes.e2e-spec.ts`; this suite
 * builds its app without `configureApp`. The suite boots `AppModule` on the shared
 * `_test` database, which applies the migrations and seeds the campus, and does not rebuild the
 * schema. Every row it writes uses a `zz_` class code or a `ZZ-` asset code, which the seed never
 * uses, and is deleted after each case (assets first: they restrict the deletion of their class).
 * The "seeded catalogue" cases are the exception: they take seed rows away or rename a zone, and put
 * everything back through the seed itself (`SeedService`), in `finally`.
 */
describe('Asset catalogue (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let zoneId: string;

  const sweep = async () => {
    // First the incidents these cases raised: their foreign keys to the asset and the rule are
    // RESTRICT (V2-07.2), so the deletes below would be refused while one exists.
    await db.query(
      `DELETE FROM "incident" WHERE "code" LIKE 'ZZT-%'
          OR "asset_id" IN (SELECT "id" FROM "asset" WHERE "code" LIKE 'ZZ-%')`,
    );
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

  const addPoint = (classId: string, over: Row = {}) =>
    insert('telemetry_point', {
      asset_class_id: classId,
      key: 'motorTempC',
      label: 'Motor temperature',
      unit: '°C',
      kind: 'number',
      min: 0,
      max: 150,
      expected_interval_s: 5,
      ...over,
    });

  const addAsset = (classId: string, over: Row = {}) =>
    insert('asset', {
      code: 'ZZ-T1',
      name: 'Test asset',
      asset_class_id: classId,
      zone_id: zoneId,
      lng: 108.4,
      lat: 11.95,
      elevation_m: 0,
      heading_deg: 0,
      ...over,
    });

  const addRule = (classId: string, over: Row = {}) =>
    insert('telemetry_rule', {
      asset_class_id: classId,
      name: 'Motor over-temperature',
      key: 'motorTempC',
      comparator: 'above',
      limit: 85,
      clear: 80,
      for_s: 60,
      severity: 'critical',
      ...over,
    });

  /** A class with the `motorTempC` number point and the `running` boolean point. */
  const addClassWithPoints = async (code = 'zz_class') => {
    const classId = await addClass({ code });
    await addPoint(classId);
    await addPoint(classId, {
      key: 'running',
      label: 'Running',
      unit: null,
      kind: 'boolean',
      min: null,
      max: null,
    });
    return classId;
  };

  const refused = (attempt: Promise<unknown>, code: string, constraint: string) =>
    expect(attempt).rejects.toMatchObject({ code, constraint });

  const count = async (table: string, where: string, params: unknown[]): Promise<number> => {
    const rows: { n: string }[] = await db.query(
      `SELECT count(*) AS n FROM "${table}" WHERE ${where}`,
      params,
    );
    return Number(rows[0].n);
  };

  beforeAll(async () => {
    assertTestDatabase(validateEnv(process.env).DB_NAME);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);

    // A seeded zone to hold the fixture assets; the seed runs at boot (`SEED_ON_BOOT`).
    const zones: { id: string }[] = await db.query(
      `SELECT "id" FROM "zone" ORDER BY "code" LIMIT 1`,
    );
    zoneId = zones[0].id;
    // A run that was killed halfway leaves rows behind.
    await sweep();
  });

  afterEach(async () => {
    await sweep();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates the four tables, and leaves zone.height_m to its own migration', async () => {
    const tables: { table_name: string }[] = await db.query(
      `SELECT "table_name" FROM information_schema.tables
        WHERE "table_schema" = 'public' AND "table_name" = ANY($1)`,
      [['asset_class', 'telemetry_point', 'asset', 'telemetry_rule']],
    );
    expect(tables.map((table) => table.table_name).sort()).toEqual([
      'asset',
      'asset_class',
      'telemetry_point',
      'telemetry_rule',
    ]);

    const heights = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE "table_name" = 'zone' AND "column_name" = 'height_m'`,
    );
    expect(heights).toHaveLength(1);
  });

  /**
   * The reading history (V2-06.9). A day in year 2100 holds the rows these cases write, so no
   * partition a leader keeps is touched; assets are swept by the outer `afterEach`, which takes
   * their samples with them, and the partition is dropped here.
   */
  describe('telemetry sample', () => {
    const DAY = 'telemetry_sample_21000101';
    const BUCKET = '2100-01-01T00:00:00.000Z';

    const addPartition = () =>
      db.query(
        `CREATE TABLE IF NOT EXISTS "${DAY}" PARTITION OF "telemetry_sample"
           FOR VALUES FROM ('2100-01-01T00:00:00Z') TO ('2100-01-02T00:00:00Z')`,
      );

    const addSample = (assetId: string, values = `{"motorTempC": 40}`) =>
      db.query(
        `INSERT INTO "telemetry_sample" ("asset_id", "bucket_at", "values") VALUES ($1, $2, $3)`,
        [assetId, BUCKET, values],
      );

    afterEach(async () => {
      await db.query(`DROP TABLE IF EXISTS "${DAY}"`);
    });

    it('is partitioned by range on bucket_at, and has its first partitions', async () => {
      const parent = await db.query(
        `SELECT pt."partstrat" AS strategy, a."attname" AS key
           FROM pg_partitioned_table pt
           JOIN pg_class c ON c."oid" = pt."partrelid"
           JOIN pg_attribute a ON a."attrelid" = pt."partrelid" AND a."attnum" = pt."partattrs"[0]
          WHERE c."relname" = 'telemetry_sample'`,
      );
      expect(parent).toEqual([{ strategy: 'r', key: 'bucket_at' }]);

      const partitions: { name: string }[] = await db.query(
        `SELECT c."relname" AS name FROM pg_inherits i JOIN pg_class c ON c."oid" = i."inhrelid"
          WHERE i."inhparent" = 'telemetry_sample'::regclass`,
      );
      expect(partitions.length).toBeGreaterThanOrEqual(1);
      for (const { name } of partitions) expect(name).toMatch(/^telemetry_sample_\d{8}$/);
    });

    it('names its primary key and its foreign key', async () => {
      const constraints = await db.query(
        `SELECT "conname", "contype" FROM pg_constraint
          WHERE "conrelid" = 'telemetry_sample'::regclass AND "contype" IN ('p', 'f')
          ORDER BY "conname"`,
      );
      expect(constraints).toEqual([
        { conname: 'fk_telemetry_sample_asset', contype: 'f' },
        { conname: 'pk_telemetry_sample', contype: 'p' },
      ]);
    });

    it('refuses a sample for an asset that does not exist', async () => {
      await addPartition();

      await expect(addSample(randomUUID())).rejects.toMatchObject({ code: '23503' });
    });

    it('keeps one row per asset and bucket', async () => {
      await addPartition();
      const assetId = await addAsset(await addClassWithPoints());
      await addSample(assetId);

      await expect(addSample(assetId)).rejects.toMatchObject({ code: '23505' });
    });

    it('refuses a bucket no partition covers', async () => {
      const assetId = await addAsset(await addClassWithPoints());

      await expect(addSample(assetId)).rejects.toMatchObject({ code: '23514' });
    });

    it('removes the samples of an asset that is deleted', async () => {
      await addPartition();
      const assetId = await addAsset(await addClassWithPoints());
      await addSample(assetId);
      expect(await count('telemetry_sample', `"asset_id" = $1`, [assetId])).toBe(1);

      await db.query(`DELETE FROM "asset" WHERE "id" = $1`, [assetId]);

      expect(await count('telemetry_sample', `"asset_id" = $1`, [assetId])).toBe(0);
    });
  });

  describe('asset class', () => {
    it('refuses a second class with the same code', async () => {
      await addClass();
      await refused(addClass(), '23505', 'uq_asset_class_code');
    });

    it('refuses a code that is not lower snake case', async () => {
      for (const code of ['Zz_class', 'z', 'zz-class', 'zz class']) {
        await refused(addClass({ code }), '23514', 'asset_class_code_check');
      }
    });

    it('refuses a footprint that is not positive', async () => {
      for (const column of ['footprint_w_m', 'footprint_d_m', 'footprint_h_m']) {
        await refused(addClass({ [column]: 0 }), '23514', 'asset_class_footprint_check');
        await refused(addClass({ [column]: -1 }), '23514', 'asset_class_footprint_check');
      }
    });
  });

  describe('telemetry point', () => {
    it('refuses a key that breaks the pattern', async () => {
      const classId = await addClass();
      for (const key of ['MotorTemp', 'motor_temp', 'motor-temp', '1motor']) {
        await refused(addPoint(classId, { key }), '23514', 'telemetry_point_key_check');
      }
    });

    it('refuses an unknown kind, and an interval that is not positive', async () => {
      const classId = await addClass();
      await refused(addPoint(classId, { kind: 'string' }), '23514', 'telemetry_point_kind_check');
      await refused(
        addPoint(classId, { expected_interval_s: 0 }),
        '23514',
        'telemetry_point_expected_interval_check',
      );
    });

    it('keeps a key unique within its class only', async () => {
      const classId = await addClass();
      await addPoint(classId);
      await refused(addPoint(classId), '23505', 'uq_telemetry_point_class_key');

      const otherId = await addClass({ code: 'zz_other' });
      await expect(addPoint(otherId)).resolves.toEqual(expect.any(String));
    });

    it('refuses a range whose minimum is past its maximum', async () => {
      const classId = await addClass();
      await refused(addPoint(classId, { min: 10, max: 5 }), '23514', 'telemetry_point_range_check');
      // Either bound may be missing: `runHoursH` has no maximum.
      await expect(addPoint(classId, { key: 'runHoursH', min: 0, max: null })).resolves.toEqual(
        expect.any(String),
      );
    });

    it('allows a headline rank of 1 or 2, once per class', async () => {
      const classId = await addClass();
      await refused(
        addPoint(classId, { key: 'rankZero', headline: 0 }),
        '23514',
        'telemetry_point_headline_check',
      );
      await refused(
        addPoint(classId, { key: 'rankThree', headline: 3 }),
        '23514',
        'telemetry_point_headline_check',
      );

      await addPoint(classId, { key: 'first', headline: 1 });
      await addPoint(classId, { key: 'second', headline: 2 });
      await refused(
        addPoint(classId, { key: 'third', headline: 1 }),
        '23505',
        'uq_telemetry_point_class_headline',
      );
      // Many points may have no rank.
      await addPoint(classId, { key: 'none1' });
      await addPoint(classId, { key: 'none2' });

      // Another class has its own ranks.
      const otherId = await addClass({ code: 'zz_other' });
      await expect(addPoint(otherId, { key: 'first', headline: 1 })).resolves.toEqual(
        expect.any(String),
      );
    });

    it('sets the enum values exactly for an enum point, as a non-empty array', async () => {
      const classId = await addClass();
      const refusedEnum = (over: Row) =>
        refused(addPoint(classId, over), '23514', 'telemetry_point_enum_values_check');

      // An enum with no values, with none that count, and with a value that is not an array.
      await refusedEnum({ key: 'noValues', kind: 'enum', enum_values: null });
      await refusedEnum({ key: 'emptyList', kind: 'enum', enum_values: JSON.stringify([]) });
      await refusedEnum({ key: 'scalar', kind: 'enum', enum_values: JSON.stringify('auto') });
      await refusedEnum({ key: 'jsonNull', kind: 'enum', enum_values: 'null' });
      // Values on a point that is not an enum.
      await refusedEnum({ key: 'numberWith', kind: 'number', enum_values: JSON.stringify(['a']) });
      await refusedEnum({ key: 'boolWith', kind: 'boolean', enum_values: JSON.stringify(['a']) });

      await expect(
        addPoint(classId, {
          key: 'switchState',
          kind: 'enum',
          unit: null,
          min: null,
          max: null,
          enum_values: JSON.stringify(['off', 'auto', 'hand']),
        }),
      ).resolves.toEqual(expect.any(String));
    });
  });

  describe('asset', () => {
    it('refuses a second asset with the same code', async () => {
      const classId = await addClass();
      await addAsset(classId);
      await refused(addAsset(classId), '23505', 'uq_asset_code');
    });

    it('refuses a code that does not follow the operators tag pattern', async () => {
      const classId = await addClass();
      // Lower case, a suffix of one, a prefix of five, a suffix of seven, no dash.
      for (const code of ['ZZ-t1', 'ZZ-1', 'ZZZZZ-01', 'ZZ-ABCDEFG', 'ZZT1']) {
        await refused(addAsset(classId, { code }), '23514', 'asset_code_check');
      }
      // The widest tag the pattern allows (V2-05.1).
      await expect(addAsset(classId, { code: 'ZZ-A1B2C3' })).resolves.toEqual(expect.any(String));
    });

    it('refuses a negative elevation and a heading outside 0 to 360', async () => {
      const classId = await addClass();
      await refused(addAsset(classId, { elevation_m: -1 }), '23514', 'asset_elevation_check');
      await refused(addAsset(classId, { heading_deg: 360 }), '23514', 'asset_heading_check');
      await refused(addAsset(classId, { heading_deg: -0.5 }), '23514', 'asset_heading_check');

      // A roof, and the last degree before north.
      await expect(addAsset(classId, { elevation_m: 14, heading_deg: 359.9 })).resolves.toEqual(
        expect.any(String),
      );
    });

    it('refuses a class or a zone that does not exist', async () => {
      const classId = await addClass();
      await refused(addAsset(randomUUID()), '23503', 'fk_asset_class');
      await refused(addAsset(classId, { zone_id: randomUUID() }), '23503', 'fk_asset_zone');
    });

    it('refuses to delete a class that still has an asset', async () => {
      const classId = await addClass();
      await addAsset(classId);
      await refused(
        db.query(`DELETE FROM "asset_class" WHERE "id" = $1`, [classId]),
        '23503',
        'fk_asset_class',
      );
      expect(await count('asset_class', `"id" = $1`, [classId])).toBe(1);
    });
  });

  describe('telemetry rule', () => {
    it('accepts exactly the facilities and environment types of the contract', async () => {
      const classId = await addClassWithPoints();
      for (const type of INCIDENT_TYPES) {
        const allowed = ['facilities', 'environment'].includes(categoryOf(type));
        const attempt = addRule(classId, { name: `Rule ${type}`, incident_type: type });
        if (allowed) {
          await expect(attempt).resolves.toEqual(expect.any(String));
        } else {
          await refused(attempt, '23514', 'telemetry_rule_incident_type_check');
        }
      }
    });

    it('defaults the incident type to equipment_fault and the rule to enabled', async () => {
      const classId = await addClassWithPoints();
      const ruleId = await addRule(classId);
      const rows: { incident_type: string; enabled: boolean }[] = await db.query(
        `SELECT "incident_type", "enabled" FROM "telemetry_rule" WHERE "id" = $1`,
        [ruleId],
      );
      expect(rows[0]).toEqual({ incident_type: 'equipment_fault', enabled: true });
    });

    it('refuses a clear level on the wrong side of the limit', async () => {
      const classId = await addClassWithPoints();
      const refusedClear = (over: Row) =>
        refused(addRule(classId, over), '23514', 'telemetry_rule_clear_check');

      // `above` re-arms below its limit; `below` re-arms above its limit.
      await refusedClear({ name: 'Above', comparator: 'above', limit: 85, clear: 90 });
      await refusedClear({ name: 'Below', comparator: 'below', limit: 25, clear: 20 });

      await addRule(classId, { name: 'Above ok', comparator: 'above', limit: 85, clear: 80 });
      await addRule(classId, { name: 'Below ok', comparator: 'below', limit: 25, clear: 30 });
      // A boolean rule has no hysteresis: both are 0.5.
      await addRule(classId, {
        name: 'Running',
        key: 'running',
        comparator: 'below',
        limit: 0.5,
        clear: 0.5,
      });
    });

    it('refuses an unknown comparator and severity, and a negative duration', async () => {
      const classId = await addClassWithPoints();
      // An unknown comparator breaks two CHECKs: its own, and the one on `clear`, which only
      // knows `above` and `below`. Postgres reports the first by name, so either is the answer.
      await expect(addRule(classId, { comparator: 'equal' })).rejects.toMatchObject({
        code: '23514',
        constraint: expect.stringMatching(/^telemetry_rule_(clear|comparator)_check$/),
      });
      await refused(
        addRule(classId, { severity: 'urgent' }),
        '23514',
        'telemetry_rule_severity_check',
      );
      await refused(addRule(classId, { for_s: -1 }), '23514', 'telemetry_rule_for_s_check');
      // A breach that raises at once.
      await expect(addRule(classId, { for_s: 0 })).resolves.toEqual(expect.any(String));
    });

    it('refuses a rule whose key is not a point of its class', async () => {
      const classId = await addClassWithPoints();
      await refused(addRule(classId, { key: 'noSuchPoint' }), '23503', 'fk_telemetry_rule_point');

      // A point of another class does not count.
      const otherId = await addClass({ code: 'zz_other' });
      await addPoint(otherId, { key: 'onlyOther' });
      await refused(addRule(classId, { key: 'onlyOther' }), '23503', 'fk_telemetry_rule_point');
    });

    it('refuses to delete a point that a rule watches', async () => {
      const classId = await addClassWithPoints();
      await addRule(classId);
      await refused(
        db.query(`DELETE FROM "telemetry_point" WHERE "asset_class_id" = $1 AND "key" = $2`, [
          classId,
          'motorTempC',
        ]),
        '23503',
        'fk_telemetry_rule_point',
      );
    });

    it('keeps a name unique among class rules and among one asset overrides', async () => {
      const classId = await addClassWithPoints();
      const assetId = await addAsset(classId);
      const otherAssetId = await addAsset(classId, { code: 'ZZ-T2' });

      await addRule(classId);
      await refused(addRule(classId), '23505', 'uq_telemetry_rule_class_name');

      // An override may carry the name of the class rule it replaces, once per asset.
      await addRule(classId, { asset_id: assetId, limit: 90, clear: 85 });
      await refused(
        addRule(classId, { asset_id: assetId, limit: 95, clear: 90 }),
        '23505',
        'uq_telemetry_rule_asset_name',
      );
      await expect(
        addRule(classId, { asset_id: otherAssetId, limit: 95, clear: 90 }),
      ).resolves.toEqual(expect.any(String));

      // The same class rule name in another class is a different rule.
      const otherId = await addClassWithPoints('zz_other');
      await expect(addRule(otherId)).resolves.toEqual(expect.any(String));
    });

    it('refuses an override on an asset of another class', async () => {
      const classId = await addClassWithPoints();
      const otherId = await addClassWithPoints('zz_other');
      const assetId = await addAsset(classId);

      // `zz_other` has the point, so only the asset's class can be what is wrong.
      await refused(addRule(otherId, { asset_id: assetId }), '23503', 'fk_telemetry_rule_asset');
    });
  });

  describe('deletion', () => {
    it('removes the overrides of an asset and keeps the class rule', async () => {
      const classId = await addClassWithPoints();
      const assetId = await addAsset(classId);
      await addRule(classId);
      await addRule(classId, { asset_id: assetId, limit: 90, clear: 85 });

      await db.query(`DELETE FROM "asset" WHERE "id" = $1`, [assetId]);

      expect(await count('telemetry_rule', `"asset_class_id" = $1`, [classId])).toBe(1);
      expect(await count('telemetry_rule', `"asset_id" = $1`, [assetId])).toBe(0);
    });

    it('removes the points and the rules of a class with it, in one statement', async () => {
      const classId = await addClassWithPoints();
      await addRule(classId);
      await addRule(classId, { name: 'Running', key: 'running', limit: 0.5, clear: 0.5 });
      expect(await count('telemetry_point', `"asset_class_id" = $1`, [classId])).toBe(2);

      await db.query(`DELETE FROM "asset_class" WHERE "id" = $1`, [classId]);

      expect(await count('telemetry_point', `"asset_class_id" = $1`, [classId])).toBe(0);
      expect(await count('telemetry_rule', `"asset_class_id" = $1`, [classId])).toBe(0);
    });
  });

  /**
   * V2-07.2: an incident names the asset and the rule that raised it, and the database allows one
   * unresolved incident per pair. Raw SQL, as above: the service that raises one is in the
   * incidents suite.
   */
  describe('incident link', () => {
    let serial = 0;

    /** One incident row; `code` carries the sweep's `ZZT-` prefix. */
    const addIncident = (over: Row = {}) =>
      insert('incident', {
        code: `ZZT-${String(++serial).padStart(4, '0')}${randomUUID().slice(0, 4)}`,
        type: 'equipment_fault',
        severity: 'high',
        status: 'open',
        title: 'Motor over-temperature',
        zone_id: zoneId,
        lng: 108.4,
        lat: 11.95,
        source: 'telemetry',
        reported_at: new Date(),
        ...over,
      });

    const pair = async () => {
      const classId = await addClassWithPoints();
      return { assetId: await addAsset(classId), ruleId: await addRule(classId) };
    };

    it('creates the two nullable columns, the two keys and the three indexes', async () => {
      const columns: { column_name: string; is_nullable: string; column_default: string | null }[] =
        await db.query(
          `SELECT "column_name", "is_nullable", "column_default" FROM information_schema.columns
            WHERE "table_name" = 'incident' AND "column_name" IN ('asset_id', 'telemetry_rule_id')
            ORDER BY "column_name"`,
        );
      expect(columns).toEqual([
        { column_name: 'asset_id', is_nullable: 'YES', column_default: null },
        { column_name: 'telemetry_rule_id', is_nullable: 'YES', column_default: null },
      ]);

      const keys: { conname: string; confdeltype: string }[] = await db.query(
        `SELECT "conname", "confdeltype" FROM pg_constraint
          WHERE "conrelid" = 'incident'::regclass AND "contype" = 'f'
            AND "conname" IN ('fk_incident_asset', 'fk_incident_telemetry_rule')
          ORDER BY "conname"`,
      );
      // 'r' is RESTRICT: a rule or an asset leaving the catalogue never takes an incident with it.
      expect(keys).toEqual([
        { conname: 'fk_incident_asset', confdeltype: 'r' },
        { conname: 'fk_incident_telemetry_rule', confdeltype: 'r' },
      ]);

      const indexes: { indexname: string }[] = await db.query(
        `SELECT "indexname" FROM pg_indexes
          WHERE "tablename" = 'incident' AND "indexname" IN
            ('uq_incident_open_asset_rule', 'idx_incident_asset', 'idx_incident_telemetry_rule')
          ORDER BY "indexname"`,
      );
      expect(indexes.map((index) => index.indexname)).toEqual([
        'idx_incident_asset',
        'idx_incident_telemetry_rule',
        'uq_incident_open_asset_rule',
      ]);
    });

    it('refuses a second unresolved incident for the same asset and rule', async () => {
      const { assetId, ruleId } = await pair();
      await addIncident({ asset_id: assetId, telemetry_rule_id: ruleId });

      await refused(
        addIncident({ asset_id: assetId, telemetry_rule_id: ruleId }),
        '23505',
        'uq_incident_open_asset_rule',
      );
      // Acknowledged is still unresolved.
      await refused(
        addIncident({ asset_id: assetId, telemetry_rule_id: ruleId, status: 'acknowledged' }),
        '23505',
        'uq_incident_open_asset_rule',
      );
    });

    it('accepts a new one once the first is resolved', async () => {
      const { assetId, ruleId } = await pair();
      await addIncident({
        asset_id: assetId,
        telemetry_rule_id: ruleId,
        status: 'resolved',
        resolved_at: new Date(),
      });

      await addIncident({ asset_id: assetId, telemetry_rule_id: ruleId });
      // Resolved ones do not count, however many there are.
      await addIncident({
        asset_id: assetId,
        telemetry_rule_id: ruleId,
        status: 'resolved',
        resolved_at: new Date(),
      });
      expect(await count('incident', `"asset_id" = $1`, [assetId])).toBe(3);
    });

    it('constrains a pair, not an asset or a rule on its own', async () => {
      const classId = await addClassWithPoints();
      const assetA = await addAsset(classId, { code: 'ZZ-A1' });
      const assetB = await addAsset(classId, { code: 'ZZ-B1' });
      const rule = await addRule(classId);
      const other = await addRule(classId, {
        name: 'Running',
        key: 'running',
        limit: 0.5,
        clear: 0.5,
      });

      await addIncident({ asset_id: assetA, telemetry_rule_id: rule });
      await addIncident({ asset_id: assetB, telemetry_rule_id: rule });
      await addIncident({ asset_id: assetA, telemetry_rule_id: other });
      expect(await count('incident', `"asset_id" = ANY($1)`, [[assetA, assetB]])).toBe(3);
    });

    it('never constrains an incident without an asset', async () => {
      await addIncident({ source: 'operator' });
      await addIncident({ source: 'operator' });
      await addIncident({ source: 'operator', telemetry_rule_id: null, asset_id: null });

      expect(await count('incident', `"code" LIKE 'ZZT-%'`, [])).toBe(3);
    });

    it('refuses to delete an asset or a rule an incident names', async () => {
      const { assetId, ruleId } = await pair();
      await addIncident({ asset_id: assetId, telemetry_rule_id: ruleId });

      await refused(
        db.query(`DELETE FROM "telemetry_rule" WHERE "id" = $1`, [ruleId]),
        '23503',
        'fk_incident_telemetry_rule',
      );
      await refused(
        db.query(`DELETE FROM "asset" WHERE "id" = $1`, [assetId]),
        '23503',
        'fk_incident_asset',
      );
    });

    it('refuses an asset or a rule that does not exist', async () => {
      await refused(addIncident({ asset_id: randomUUID() }), '23503', 'fk_incident_asset');
      await refused(
        addIncident({ telemetry_rule_id: randomUUID() }),
        '23503',
        'fk_incident_telemetry_rule',
      );
    });
  });

  /**
   * V2-05.4 and V2-05.5: the seed fills the catalogue and the demo assets on boot and tops up what
   * is missing (ADR-0017). An asset restricts the deletion of its class and its zone, so a case
   * that deletes a seed class deletes the assets of that class first.
   */
  describe('seeded catalogue', () => {
    const SEED_CODES = ASSET_CLASSES.map((assetClass) => assetClass.code);
    const SEED_ASSET_CODES = ASSETS.map((asset) => asset.code);
    const OF_SEED_CLASSES = `"asset_class_id" IN (SELECT "id" FROM "asset_class" WHERE "code" = ANY($1))`;

    /** The seed's rows only: other cases' fixtures never share a code with them. */
    const seedCounts = async () => ({
      classes: await count('asset_class', `"code" = ANY($1)`, [SEED_CODES]),
      points: await count('telemetry_point', OF_SEED_CLASSES, [SEED_CODES]),
      rules: await count('telemetry_rule', `"asset_id" IS NULL AND ${OF_SEED_CLASSES}`, [
        SEED_CODES,
      ]),
      assets: await count('asset', `"code" = ANY($1)`, [SEED_ASSET_CODES]),
    });

    /** Every seed row's id, so "nothing was touched" can be asserted on the rows themselves. */
    const seedRowIds = async () => {
      const ids = async (table: string, where: string, codes: string[] = SEED_CODES) => {
        const rows: { id: string }[] = await db.query(
          `SELECT "id" FROM "${table}" WHERE ${where} ORDER BY "id"`,
          [codes],
        );
        return rows.map((row) => row.id);
      };
      return {
        classes: await ids('asset_class', `"code" = ANY($1)`),
        points: await ids('telemetry_point', OF_SEED_CLASSES),
        rules: await ids('telemetry_rule', OF_SEED_CLASSES),
        assets: await ids('asset', `"code" = ANY($1)`, SEED_ASSET_CODES),
      };
    };

    const limitOf = async (name: string): Promise<number> => {
      const rows: { limit: number }[] = await db.query(
        `SELECT "limit" FROM "telemetry_rule" WHERE "name" = $1 AND "asset_id" IS NULL`,
        [name],
      );
      return rows[0].limit;
    };

    it('has the whole catalogue and the demo assets after boot', async () => {
      expect(await seedCounts()).toEqual({ classes: 16, points: 66, rules: 22, assets: 31 });
    });

    it('fills in what is missing and keeps a limit an operator changed', async () => {
      const seed = app.get(SeedService);

      try {
        // An operator tightened one limit. A whole class is gone (its points and rules cascade, and
        // its asset goes first: `asset.asset_class_id` restricts), one point nothing watches is
        // gone, and so is one rule of a class that is otherwise there.
        await db.query(
          `UPDATE "telemetry_rule" SET "limit" = 90 WHERE "name" = 'Motor over-temperature'`,
        );
        await db.query(`DELETE FROM "asset" WHERE "code" = 'LKS-B3'`);
        await db.query(`DELETE FROM "asset_class" WHERE "code" = 'leak_sensor'`);
        await db.query(
          `DELETE FROM "telemetry_point" WHERE "key" = 'returnAirTempC'
              AND "asset_class_id" = (SELECT "id" FROM "asset_class" WHERE "code" = 'precision_cooling')`,
        );
        await db.query(`DELETE FROM "telemetry_rule" WHERE "name" = 'High vibration'`);
        expect(await seedCounts()).toEqual({ classes: 15, points: 63, rules: 19, assets: 30 });

        await seed.onApplicationBootstrap();

        // The class is back first, then the asset that stands in it.
        expect(await seedCounts()).toEqual({ classes: 16, points: 66, rules: 22, assets: 31 });
        // What was missing is back with the seed's values; the changed limit was not rewritten.
        expect(await limitOf('High vibration')).toBe(7.1);
        expect(await limitOf('Water leak')).toBe(0.5);
        expect(await limitOf('Motor over-temperature')).toBe(90);

        // Nothing is left to add, so a further boot changes no row.
        const settled = await seedRowIds();
        await seed.onApplicationBootstrap();
        expect(await seedRowIds()).toEqual(settled);
      } finally {
        await db.query(
          `UPDATE "telemetry_rule" SET "limit" = 85 WHERE "name" = 'Motor over-temperature'`,
        );
        await seed.onApplicationBootstrap();
      }
    });

    it('adds no catalogue to a database that is not the reference campus', async () => {
      const seed = app.get(SeedService);

      try {
        // The library is not there under its code, so this is not the reference campus: the
        // seed's data does not belong here, and a class and an asset that are gone stay gone.
        await db.query(`DELETE FROM "asset" WHERE "code" = 'LKS-B3'`);
        await db.query(`DELETE FROM "asset_class" WHERE "code" = 'leak_sensor'`);
        await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB-RENAMED' WHERE "code" = 'BLD-LIB'`);

        await seed.onApplicationBootstrap();
        expect(await count('asset_class', `"code" = 'leak_sensor'`, [])).toBe(0);
        expect(await count('asset', `"code" = 'LKS-B3'`, [])).toBe(0);

        await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB' WHERE "code" = 'BLD-LIB-RENAMED'`);
        await seed.onApplicationBootstrap();
        expect(await count('asset_class', `"code" = 'leak_sensor'`, [])).toBe(1);
        expect(await count('asset', `"code" = 'LKS-B3'`, [])).toBe(1);
        expect(await seedCounts()).toEqual({ classes: 16, points: 66, rules: 22, assets: 31 });
      } finally {
        await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB' WHERE "code" = 'BLD-LIB-RENAMED'`);
        await seed.onApplicationBootstrap();
      }
    });

    it('adds the seed assets a catalogue that otherwise looks complete lacks', async () => {
      const seed = app.get(SeedService);
      // The cooling tower stays and an operator changed it; every other seed asset goes.
      const kept = ASSETS.find((asset) => asset.code === 'CT-01')!;
      const removed = SEED_ASSET_CODES.filter((code) => code !== kept.code);
      const assetRows = async () =>
        db.query(
          `SELECT "id", "code", "name", "zone_id", "asset_class_id", "lng", "lat", "elevation_m",
                  "heading_deg"
             FROM "asset" WHERE "code" = ANY($1) ORDER BY "code"`,
          [SEED_ASSET_CODES],
        );

      try {
        // The classes, points, rules and zones are all there: only assets are missing, which is
        // the state of a V2-05.4 volume. Only the asset check can send this boot to the top-up.
        await db.query(`DELETE FROM "asset" WHERE "code" = ANY($1)`, [removed]);
        await db.query(
          `UPDATE "asset" SET "name" = 'Renamed by operator', "heading_deg" = 90 WHERE "code" = $1`,
          [kept.code],
        );
        expect((await seedCounts()).assets).toBe(1);

        await seed.onApplicationBootstrap();

        expect(await seedCounts()).toEqual({ classes: 16, points: 66, rules: 22, assets: 31 });
        // The one that existed was not rewritten.
        expect(
          await db.query(`SELECT "name", "heading_deg" FROM "asset" WHERE "code" = $1`, [
            kept.code,
          ]),
        ).toEqual([{ name: 'Renamed by operator', heading_deg: 90 }]);
        // One that was added back has the seed's values, resolved to its zone and class by code.
        expect(
          await db.query(
            `SELECT z."code" AS zone, c."code" AS class, a."elevation_m"
               FROM "asset" a
               JOIN "zone" z ON z."id" = a."zone_id"
               JOIN "asset_class" c ON c."id" = a."asset_class_id"
              WHERE a."code" = 'LKS-B3'`,
          ),
        ).toEqual([{ zone: 'BLD-DORB', class: 'leak_sensor', elevation_m: 8 }]);

        // Nothing is left to add, so a further boot changes no row.
        const settled = await assetRows();
        await seed.onApplicationBootstrap();
        expect(await assetRows()).toEqual(settled);
      } finally {
        // A top-up keeps a value that is set, so the operator's change is put back by hand.
        await db.query(`UPDATE "asset" SET "name" = $2, "heading_deg" = $3 WHERE "code" = $1`, [
          kept.code,
          kept.name,
          kept.headingDeg,
        ]);
        await seed.onApplicationBootstrap();
      }
    });
  });
});

/** Like the other suites: never write to a database whose name does not end in `_test`. */
function assertTestDatabase(name: string): void {
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run against database "${name}": e2e needs a *_test database.`);
  }
}
