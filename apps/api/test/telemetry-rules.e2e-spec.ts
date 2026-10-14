import type { INestApplication, Type } from '@nestjs/common';
import {
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  type Incident,
  IncidentEvents,
  type ServerToClientEvents,
} from '@occ/contracts';
import { Registry } from '@prometheus-io/client';
import { io, type Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { AssetsService } from '../src/assets/assets.service';
import type { AppModule as AppModuleClass } from '../src/app.module';
import { validateEnv } from '../src/config/env.validation';
import { SystemActors } from '../src/incidents/actors';
import { IncidentsService } from '../src/incidents/incidents.service';
import { MockTelemetrySource } from '../src/telemetry/mock-telemetry-source';
import { OffTelemetrySource } from '../src/telemetry/off-telemetry-source';
import { RuleEvaluator } from '../src/telemetry/rule-evaluator.service';
import { TelemetryIngestService } from '../src/telemetry/telemetry-ingest.service';
import { TelemetryLeader } from '../src/telemetry/telemetry-leader.service';
import { TELEMETRY_SOURCE } from '../src/telemetry/telemetry-source.provider';
import { assertTestDatabase, eventually, startApp } from './support/app';
import { signToken } from './support/tokens';

type EventsSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Row = Record<string, unknown>;

const CLASS_CODE = 'zz_rules';
const ASSET_CODE = 'ZZ-R1';
const ASSET_NAME = 'Rule test asset';
const RULE_NAME = 'ZZ over-temperature';
const DISABLED_RULE_NAME = 'ZZ disabled vibration';

/** Short enough for a case to take seconds; long enough that a breach can be shorter than it. */
const FOR_S = 2;
const READING_EVERY_MS = 250;

/**
 * The alarm path through the whole app (ADR-0018, "Proving it"): a reading enters the ingest
 * service, the telemetry leader's evaluator decides, `IncidentsService` writes through the outbox,
 * and `/events` delivers. The source is silent (`OffTelemetrySource`) on purpose: the mock
 * generator would also emit readings for the fixture asset and interrupt a breach; every reading
 * here is fed by the case.
 *
 * The fixtures (a class, two points, an asset and two rules with a `for_s` of two seconds) are
 * written before the apps under test start, because ingest and the evaluator read the catalogue
 * at start. `AppModule` validates the environment when it is imported, so the source is set to
 * `mock` first (it is what lets the leader run) and the module is loaded afterwards.
 *
 * Those cases feed `ingest()` on purpose. One more runs the mock source's demo scenario (V2-07.5)
 * into the same ingest service, so the whole path from a scripted breach to `/events` is covered
 * without letting the generator interrupt the others.
 *
 * Real database, real clock, a few seconds per case. Run it on its own, `--runInBand`.
 */
describe('Threshold rules raise incidents (e2e)', () => {
  let AppModule: Type<unknown>;
  let app: INestApplication;
  let db: DataSource;
  let ingest: TelemetryIngestService;
  let evaluator: RuleEvaluator;
  let incidents: IncidentsService;
  let assetId: string;
  let zoneId: string;
  let events: EventsSocket;

  const start = () =>
    startApp(AppModule, (builder) =>
      builder.overrideProvider(TELEMETRY_SOURCE).useValue(new OffTelemetrySource()),
    );

  async function sweep(target: DataSource): Promise<void> {
    // Incidents first: their foreign keys to the asset and the rule are RESTRICT (V2-07.2).
    await target.query(
      `DELETE FROM "incident" WHERE "asset_id" IN (SELECT "id" FROM "asset" WHERE "code" = $1)`,
      [ASSET_CODE],
    );
    await target.query(`DELETE FROM "asset" WHERE "code" = $1`, [ASSET_CODE]);
    await target.query(`DELETE FROM "asset_class" WHERE "code" = $1`, [CLASS_CODE]);
  }

  /** Inserts one row, quoting every identifier (`"limit"` is a reserved word); returns its id. */
  async function insert(table: string, row: Row): Promise<string> {
    const columns = Object.keys(row);
    const rows: { id: string }[] = await db.query(
      `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')})
       VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING "id"`,
      Object.values(row),
    );
    return rows[0]!.id;
  }

  async function createFixtures(): Promise<void> {
    const zones: { id: string }[] = await db.query(
      `SELECT "id" FROM "zone" ORDER BY "code" LIMIT 1`,
    );
    zoneId = zones[0]!.id;
    const classId = await insert('asset_class', {
      code: CLASS_CODE,
      name: 'Rule test class',
      footprint_w_m: 1,
      footprint_d_m: 1,
      footprint_h_m: 1,
    });
    for (const key of ['motorTempC', 'vibrationMms']) {
      await insert('telemetry_point', {
        asset_class_id: classId,
        key,
        label: key,
        unit: null,
        kind: 'number',
        min: 0,
        max: 150,
        expected_interval_s: 5,
      });
    }
    assetId = await insert('asset', {
      code: ASSET_CODE,
      name: ASSET_NAME,
      asset_class_id: classId,
      zone_id: zoneId,
      lng: 108.4,
      lat: 11.95,
      elevation_m: 0,
      heading_deg: 0,
    });
    await insert('telemetry_rule', {
      asset_class_id: classId,
      name: RULE_NAME,
      key: 'motorTempC',
      comparator: 'above',
      limit: 85,
      clear: 80,
      for_s: FOR_S,
      severity: 'high',
      incident_type: 'equipment_fault',
    });
    await insert('telemetry_rule', {
      asset_class_id: classId,
      name: DISABLED_RULE_NAME,
      key: 'vibrationMms',
      comparator: 'above',
      limit: 7,
      clear: 5,
      for_s: FOR_S,
      severity: 'high',
      incident_type: 'equipment_fault',
      enabled: false,
    });
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** One reading of the fixture asset into a replica's ingest service, every 250 ms for `ms`. */
  async function hold(
    values: Record<string, number>,
    ms: number,
    targets: TelemetryIngestService[] = [ingest],
  ): Promise<void> {
    const until = Date.now() + ms;
    do {
      for (const target of targets) target.ingest({ assetCode: ASSET_CODE, values });
      await sleep(READING_EVERY_MS);
    } while (Date.now() < until);
  }

  /** A reading well under `clear`, which re-arms the rule, then a tick that sees it. */
  async function settle(): Promise<void> {
    await hold({ motorTempC: 20, vibrationMms: 1 }, READING_EVERY_MS);
    await evaluator.evaluate();
  }

  const incidentRows = (): Promise<Row[]> =>
    db.query(
      `SELECT "id", "status", "type", "severity", "source", "title", "zone_id", "lng", "lat",
              "telemetry_rule_id"
         FROM "incident" WHERE "asset_id" = $1 ORDER BY "reported_at"`,
      [assetId],
    );

  async function incidentCount(): Promise<number> {
    return (await incidentRows()).length;
  }

  /** The count of one result of `telemetry_incidents_raised_total`, on this app's registry. */
  async function requests(result: string): Promise<number> {
    const registry = app.get(Registry);
    const { values } = await registry.getSingleMetric('telemetry_incidents_raised_total')!.get();
    return values.find((value) => value.labels.result === result)?.value ?? 0;
  }

  function nextCreated(): Promise<Incident> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        events.off(IncidentEvents.Created, listener);
        reject(new Error('Timed out waiting for incident.created'));
      }, 15_000);
      const listener = (incident: Incident) => {
        if (incident.assetId !== assetId) return;
        clearTimeout(timer);
        events.off(IncidentEvents.Created, listener);
        resolve(incident);
      };
      events.on(IncidentEvents.Created, listener);
    });
  }

  beforeAll(async () => {
    process.env.TELEMETRY_SOURCE = 'mock';
    // A `require`, not a static import: loading the module validates the environment, which must
    // already say `mock` (see `telemetry.e2e-spec.ts`). The static `import type` is erased.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ AppModule } = require('../src/app.module') as { AppModule: typeof AppModuleClass });
    assertTestDatabase(validateEnv(process.env).DB_NAME);

    // Migrates and seeds, takes the fixtures, and lets go of the lead before the real app starts.
    const bootstrap = await start();
    db = bootstrap.get(DataSource);
    await sweep(db);
    await createFixtures();
    await bootstrap.close();

    app = await start();
    db = app.get(DataSource);
    ingest = app.get(TelemetryIngestService);
    evaluator = app.get(RuleEvaluator);
    incidents = app.get(IncidentsService);

    await eventually(
      () => app.get(TelemetryLeader).isLeading(),
      (leading) => leading,
      'the telemetry leader',
      15_000,
    );
    // The tick that gains the lead has read the catalogue and taken its cursor.
    await evaluator.evaluate();

    const url = (await app.getUrl()).replace('[::1]', 'localhost');
    events = io(`${url}${EVENTS_NAMESPACE}`, {
      transports: ['websocket'],
      auth: { token: await signToken() },
    });
    await new Promise<void>((resolve, reject) => {
      events.once('connect', () => resolve());
      events.once('connect_error', reject);
    });
  }, 60_000);

  afterEach(async () => {
    await db.query(`DELETE FROM "incident" WHERE "asset_id" = $1`, [assetId]);
    await settle();
  });

  afterAll(async () => {
    events?.disconnect();
    if (db) await sweep(db);
    await app?.close();
  });

  it('raises nothing for a breach shorter than for_s', async () => {
    await hold({ motorTempC: 90 }, 1_000);
    await settle();
    await sleep(2_500);

    expect(await incidentCount()).toBe(0);
  }, 20_000);

  it('raises exactly one incident for a sustained breach, and sends it on /events', async () => {
    const created = nextCreated();

    await hold({ motorTempC: 92 }, 3_500);
    const delivered = await created;
    await sleep(1_500);

    const rows = await incidentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'open',
      type: 'equipment_fault',
      severity: 'high',
      source: 'telemetry',
      title: `${RULE_NAME} — ${ASSET_NAME}`,
      zone_id: zoneId,
      lng: 108.4,
      lat: 11.95,
    });
    expect(delivered).toMatchObject({
      id: rows[0]!.id,
      assetId,
      source: 'telemetry',
      status: 'open',
      zoneId,
      position: [108.4, 11.95],
    });

    const detail = await incidents.get(rows[0]!.id as string);
    const reported = detail.timeline.find((entry) => entry.kind === 'reported');
    expect(reported).toMatchObject({
      actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry rule' },
    });
    // The evidence is the reading that completed the dwell, and the dwell the rule asks for.
    expect(reported?.note).toBe('motorTempC 92 > 85 for 2 s');
    expect(await requests('raised')).toBe(1);
  }, 30_000);

  it('raises none for a second breach while the first incident is open', async () => {
    await hold({ motorTempC: 92 }, 3_500);
    await eventually(incidentCount, (n) => n === 1, 'the first incident', 15_000);
    const skipped = await requests('already_open');

    // The reading passes clear, then breaches again for longer than for_s.
    await settle();
    await hold({ motorTempC: 93 }, 3_500);
    await eventually(
      () => requests('already_open'),
      (n) => n > skipped,
      'the evaluator to be told the incident is open',
      15_000,
    );

    expect(await incidentCount()).toBe(1);
  }, 40_000);

  it('raises a new incident after it was resolved and the reading passed clear', async () => {
    await hold({ motorTempC: 92 }, 3_500);
    await eventually(incidentCount, (n) => n === 1, 'the first incident', 15_000);
    const [first] = await incidentRows();
    await incidents.resolve(first!.id as string, SystemActors.seed, 'system');

    // Still over the limit after the resolve: the rule is `raised`, so nothing new yet.
    await hold({ motorTempC: 92 }, 2_500);
    expect(await incidentCount()).toBe(1);

    await settle();
    await hold({ motorTempC: 92 }, 3_500);
    await eventually(incidentCount, (n) => n === 2, 'the second incident', 15_000);

    const rows = await incidentRows();
    expect(rows.map((row) => row.status).sort()).toEqual(['open', 'resolved']);
  }, 45_000);

  it('raises nothing for a rule that is disabled', async () => {
    await hold({ vibrationMms: 40 }, 3_500);
    await settle();
    await sleep(1_500);

    expect(await incidentCount()).toBe(0);
  }, 20_000);

  describe('with the mock source and its demo scenario', () => {
    let source: MockTelemetrySource | undefined;

    afterEach(async () => {
      // Before the suite's own `afterEach`, which settles the rule: nothing may still be emitting.
      await source?.stop();
      source = undefined;
    });

    it('raises one incident from a scripted breach, then none while it is open', async () => {
      // Two 5 s boundaries must fall in the window for the 2 s dwell: for_s 2 + 2 x 5 s + 1 s.
      // A 20 s cycle, so a second window follows within the case.
      const scenario = [
        { assetCode: ASSET_CODE, key: 'motorTempC', cycleS: 20, offsetS: 0, marginS: 1 },
      ];
      const assets = app.get(AssetsService);
      source = new MockTelemetrySource(
        async () => (await assets.catalogue()).filter((asset) => asset.code === ASSET_CODE),
        { tickMs: 250, scenario },
      );
      // What `TelemetryIngestService` does with its own source, on the replica that leads.
      source.onReading((reading) => ingest.ingest(reading));
      const raisedBefore = await requests('raised');
      const created = nextCreated();

      await source.start();
      const delivered = await created;

      const rows = await incidentRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'open',
        source: 'telemetry',
        type: 'equipment_fault',
      });
      expect(delivered).toMatchObject({ id: rows[0]!.id, assetId, source: 'telemetry' });
      const detail = await incidents.get(rows[0]!.id as string);
      const reported = detail.timeline.find((entry) => entry.kind === 'reported');
      expect(reported).toMatchObject({
        actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry rule' },
      });
      // The value the scenario holds: the rule's limit and the overshoot, 85 + 7.
      expect(reported?.note).toBe('motorTempC 92 > 85 for 2 s');
      expect(await requests('raised')).toBe(raisedBefore + 1);

      // The next window breaches again, after the waveform passed `clear`: told it is open, no new row.
      const skipped = await requests('already_open');
      await eventually(
        () => requests('already_open'),
        (n) => n > skipped,
        'the second window to be told the incident is open',
        40_000,
      );
      expect(await incidentCount()).toBe(1);
    }, 70_000);
  });

  describe('with a second instance', () => {
    let second: INestApplication;

    beforeAll(async () => {
      second = await start();
    }, 30_000);

    afterAll(async () => {
      await second?.close();
    });

    it('raises one incident for one breach, from the leader only', async () => {
      const apps = [app, second];
      await eventually(
        () => apps.filter((target) => target.get(TelemetryLeader).isLeading()).length,
        (count) => count === 1,
        'exactly one telemetry leader',
        15_000,
      );
      const leader = apps.find((target) => target.get(TelemetryLeader).isLeading())!;
      const follower = apps.find((target) => target !== leader)!;
      // Both have the catalogue and an armed rule before the breach; one tick each.
      await leader.get(RuleEvaluator).evaluate();
      await follower.get(RuleEvaluator).evaluate();
      const asked = new Map(
        apps.map((target) => [
          target,
          jest.spyOn(target.get(IncidentsService), 'reportFromTelemetry'),
        ]),
      );

      await hold(
        { motorTempC: 94 },
        4_500,
        apps.map((target) => target.get(TelemetryIngestService)),
      );
      await eventually(incidentCount, (n) => n === 1, 'one incident', 15_000);
      await sleep(2_000);

      expect(await incidentCount()).toBe(1);
      expect(asked.get(leader)!.mock.calls.length).toBeGreaterThan(0);
      expect(asked.get(follower)!).not.toHaveBeenCalled();

      jest.restoreAllMocks();
    }, 45_000);
  });
});
