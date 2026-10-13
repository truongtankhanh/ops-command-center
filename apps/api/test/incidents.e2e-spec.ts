import { randomUUID } from 'node:crypto';
import { type AddressInfo, createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import {
  type Camera,
  type CameraFieldOfView,
  categoryOf,
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type EventsHandshakeAuth,
  IDEMPOTENCY_KEY_HEADER,
  INCIDENT_CATEGORIES,
  INCIDENT_TYPES,
  type Incident,
  IncidentEvents,
  type IncidentType,
  type LngLat,
  type ServerToClientEvents,
  type SitePlan,
  type Zone,
} from '@occ/contracts';
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TokenVerifier } from '../src/auth/token-verifier';
import { type Env, validateEnv } from '../src/config/env.validation';
import { configureApp } from '../src/configure-app';
import { CAMERAS, INCIDENTS, REFERENCE_ZONE_CODES, ZONES } from '../src/database/seed/campus';
import { SeedService } from '../src/database/seed/seed.service';
import { SystemActors } from '../src/incidents/actors';
import { IncidentEntity } from '../src/incidents/incident.entity';
import { IncidentsService } from '../src/incidents/incidents.service';
import { persistIncident } from '../src/incidents/persist-incident';
import { OutboxEvents } from '../src/outbox/outbox-events';
import { OutboxRelay } from '../src/outbox/outbox-relay.service';
import { OutboxEntity } from '../src/outbox/outbox.entity';
import { SimulatorLeader } from '../src/simulator/simulator-leader.service';
import { SimulatorService } from '../src/simulator/simulator.service';
import { bearer, hs256Token, signToken, unsignedToken } from './support/tokens';

/** The suite's default access token, from the test issuer (`global-setup.ts`). Set in `beforeAll`. */
let token: string;

/** The default token's user (`sub` and `name` in `support/tokens.ts`) as a timeline actor. */
const OPERATOR_ACTOR = { kind: 'user', subject: 'e2e-operator', displayName: 'E2E Operator' };

/**
 * Runs the real application against a real PostgreSQL database (`DB_*` from `.env.test`
 * or the shell; its name must end in `_test`). The schema is dropped and rebuilt through
 * migrations, then the reference campus is seeded.
 */
describe('Incidents (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  let zone: Zone;

  const zonesByCode = async () => {
    const res = await api(app).get('/api/zones').expect(200);
    return new Map((res.body as Zone[]).map((z) => [z.code, z]));
  };
  const seededZone = (code: string) => ZONES.find((z) => z.code === code)!;

  beforeAll(async () => {
    // Start from an empty schema so migrations and seed run exactly as on a fresh install.
    const db = validateEnv(process.env);
    assertTestDatabase(db.DB_NAME);
    const admin = await new DataSource({
      type: 'postgres',
      host: db.DB_HOST,
      port: db.DB_PORT,
      database: db.DB_NAME,
      username: db.DB_USER,
      password: db.DB_PASSWORD,
      ssl: db.DB_SSL,
    }).initialize();
    await admin.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await admin.destroy();
    token = await signToken();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0);
    baseUrl = await app.getUrl();

    socket = io(`${baseUrl.replace('[::1]', 'localhost')}${EVENTS_NAMESPACE}`, {
      transports: ['websocket'],
      auth: { token },
    });
    // Reject on a refused handshake, so `beforeAll` fails with its reason instead of timing out.
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

    const zones = await api(app).get('/api/zones').expect(200);
    zone = (zones.body as Zone[]).find((z) => z.code === 'BLD-LIB')!;
  });

  afterAll(async () => {
    socket?.disconnect();
    await app?.close();
  });

  it('seeds the reference campus on an empty database', async () => {
    const zones = await api(app).get('/api/zones').expect(200);
    const cameras = await api(app).get('/api/cameras').expect(200);
    const incidents = await api(app).get('/api/incidents').expect(200);

    expect(zones.body).toHaveLength(20);
    expect(cameras.body).toHaveLength(20);
    expect(incidents.body).toHaveLength(10);

    // Twelve buildings carry a use and a height, the other eight neither; `null`, not missing, so
    // the keys are sent.
    const byCode = new Map((zones.body as Zone[]).map((z) => [z.code, z]));
    for (const seeded of ZONES) {
      const z = byCode.get(seeded.code);
      expect([seeded.code, z?.use, z?.heightM]).toEqual([
        seeded.code,
        seeded.use ?? null,
        seeded.heightM ?? null,
      ]);
    }
    // Literals as well, so the checks above cannot drift along with the seed.
    expect(byCode.get('BLD-LAB')).toMatchObject({
      kind: 'building',
      use: 'laboratory',
      heightM: 16,
    });
    expect(byCode.get('WTR-LAKE')).toMatchObject({ kind: 'water', use: null, heightM: null });
    const buildings = (zones.body as Zone[]).filter((z) => z.kind === 'building');
    expect(buildings).toHaveLength(12);
    for (const z of buildings) expect([z.code, z.use, z.heightM]).not.toContain(null);

    // The history spans every category (V2-04.4); the frames' water leak is a literal, so the
    // check cannot drift along with `INCIDENTS`.
    const history = incidents.body as Incident[];
    const categories = new Set(history.map((incident) => categoryOf(incident.type)));
    expect([...categories].sort()).toEqual([...INCIDENT_CATEGORIES].sort());
    const leak = history.find((incident) => incident.type === 'water_leak');
    expect(leak).toMatchObject({ severity: 'medium', status: 'acknowledged' });
    expect(leak?.zoneId).toBe(byCode.get('BLD-DORB')?.id);

    // The site plan and every camera's field of view are seeded with the campus (ADR-0017).
    const plan = (await api(app).get('/api/site-plan').expect(200)).body as SitePlan;
    expect(plan).toMatchObject({ code: 'LANGBIANG', center: [108.4415, 11.953] });
    expect(plan.features.map((feature) => feature.part)).toEqual([
      'boundary',
      'road',
      'road',
      'road',
      'field',
      'field',
      'field',
    ]);
    const boundary = plan.features[0]!.geometry;
    expect(boundary.type).toBe('Polygon');
    const ring = boundary.coordinates[0] as LngLat[];
    expect(ring.at(-1)).toEqual(ring[0]);

    for (const camera of cameras.body as Camera[]) expect(camera.fieldOfView).not.toBeNull();
    const loadingBay = (cameras.body as Camera[]).find((camera) => camera.code === 'CAM-D02');
    expect(loadingBay?.fieldOfView).toEqual({ heading: 290, angle: 90, range: 40 });
    // Literals for the cameras of the expanded campus, as for its zones above.
    const byCamera = new Map((cameras.body as Camera[]).map((camera) => [camera.code, camera]));
    expect(byCamera.get('CAM-L03')).toMatchObject({
      name: 'Science Lab, level 2',
      zoneId: byCode.get('BLD-LAB')?.id,
      online: true,
      fieldOfView: { heading: 55, angle: 90, range: 50 },
    });
    expect(byCamera.get('CAM-R06')).toMatchObject({
      zoneId: byCode.get('BLD-DORB')?.id,
      online: false,
    });
    // Every building has a camera but three the design draws none for.
    const watched = new Set((cameras.body as Camera[]).map((camera) => camera.zoneId));
    const unwatched = buildings.filter((z) => !watched.has(z.id)).map((z) => z.code);
    expect(unwatched.sort()).toEqual(['BLD-ADMIN', 'BLD-SEC', 'BLD-SPORTS']);
    // The equipment catalogue is seeded with the campus (V2-05.4). No route serves it yet, so it
    // is read from the tables, and the counts are literals so they cannot drift along with the seed.
    const db = app.get(DataSource);
    const rows = async (sql: string) => (await db.query(sql))[0] as Record<string, unknown>;
    expect(await rows(`SELECT count(*)::int AS n FROM "asset_class"`)).toEqual({ n: 16 });
    expect(await rows(`SELECT count(*)::int AS n FROM "telemetry_point"`)).toEqual({ n: 66 });
    expect(await rows(`SELECT count(*)::int AS n FROM "telemetry_rule"`)).toEqual({ n: 22 });
    expect(
      await rows(`SELECT count(*)::int AS n FROM "telemetry_rule" WHERE "asset_id" IS NOT NULL`),
    ).toEqual({ n: 0 });
    // The cooling tower: 12 points, 3 rules, and no model file yet (V2-13 sets `model_key`).
    expect(
      await rows(
        `SELECT c."model_key",
                (SELECT count(*)::int FROM "telemetry_point" p WHERE p."asset_class_id" = c."id") AS points,
                (SELECT count(*)::int FROM "telemetry_rule" r WHERE r."asset_class_id" = c."id") AS rules
           FROM "asset_class" c WHERE c."code" = 'cooling_tower'`,
      ),
    ).toEqual({ model_key: null, points: 12, rules: 3 });
    // The motor rule of frames 04 and 10, with its limits as the design gives them.
    expect(
      await rows(
        `SELECT "key", "comparator", "limit", "clear", "for_s", "severity", "incident_type"
           FROM "telemetry_rule" WHERE "name" = 'Motor over-temperature' AND "asset_id" IS NULL`,
      ),
    ).toEqual({
      key: 'motorTempC',
      comparator: 'above',
      limit: 85,
      clear: 80,
      for_s: 60,
      severity: 'critical',
      incident_type: 'equipment_fault',
    });

    // Nobody listens while seeding, so the seed announces nothing (ADR-0007).
    expect(await db.getRepository(OutboxEntity).count()).toBe(0);

    // Only seeded incidents exist yet; a resolved one has the longest timeline.
    const [seeded] = (await api(app).get('/api/incidents?status=resolved&limit=1').expect(200))
      .body;
    const detail = await api(app).get(`/api/incidents/${seeded.id}`).expect(200);
    expect(detail.body.timeline.length).toBeGreaterThan(1);
    for (const entry of detail.body.timeline) expect(entry.actor).toEqual(SystemActors.seed);
  });

  it('orders incidents unresolved first, then by severity', async () => {
    const res = await api(app).get('/api/incidents').expect(200);
    const statuses = (res.body as Incident[]).map((i) => i.status);
    const firstResolved = statuses.indexOf('resolved');

    expect(statuses.slice(firstResolved).every((s) => s === 'resolved')).toBe(true);
    expect((res.body as Incident[])[0]!.severity).toBe('high');
  });

  it('filters by status and severity', async () => {
    const res = await api(app).get('/api/incidents?status=resolved&severity=critical').expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ status: 'resolved', severity: 'critical' });
  });

  it('runs the full lifecycle and broadcasts every change', async () => {
    const created = waitFor(socket, IncidentEvents.Created);
    const report = await api(app)
      .post('/api/incidents')
      .send({
        type: 'medical',
        severity: 'high',
        title: 'Person down at entrance',
        zoneId: zone.id,
      })
      .expect(201);

    expect(report.body).toMatchObject({
      // The first code after the seeded history (a database sequence).
      code: `INC-${String(INCIDENTS.length + 1).padStart(6, '0')}`,
      status: 'open',
      source: 'operator',
      position: zone.center,
      version: 1,
    });
    expect(await created).toMatchObject({ id: report.body.id, version: 1 });

    const acknowledged = waitFor(socket, IncidentEvents.Updated);
    const ack = await api(app)
      .post(`/api/incidents/${report.body.id}/acknowledge`)
      .send({ note: 'Medic on the way' })
      .expect(200);
    expect(ack.body.version).toBe(2);
    expect(await acknowledged).toMatchObject({ status: 'acknowledged', version: 2 });

    const resolved = waitFor(socket, IncidentEvents.Updated);
    const done = await api(app)
      .post(`/api/incidents/${report.body.id}/resolve`)
      .send({})
      .expect(200);
    expect(await resolved).toMatchObject({ status: 'resolved', version: 3 });
    expect(done.body.version).toBe(3);

    expect(done.body.timeline.map((e: { kind: string }) => e.kind)).toEqual([
      'reported',
      'acknowledged',
      'resolved',
    ]);
    expect(done.body.timeline[1].note).toBe('Medic on the way');
    // Every entry names the user whose request caused it (ADR-0011).
    expect(done.body.timeline.map((e: { actor: unknown }) => e.actor)).toEqual([
      OPERATOR_ACTOR,
      OPERATOR_ACTOR,
      OPERATOR_ACTOR,
    ]);

    // No drain needed: an event is only sent when the claim that sets `published_at` commits, so
    // every row a client has heard about is already published (ADR-0008).
    const outbox = await app
      .get(DataSource)
      .getRepository(OutboxEntity)
      .find({ where: { aggregateId: report.body.id }, order: { id: 'ASC' } });
    expect(outbox.map((row) => [row.event, row.payload.version])).toEqual([
      [IncidentEvents.Created, 1],
      [IncidentEvents.Updated, 2],
      [IncidentEvents.Updated, 3],
    ]);
    expect(outbox.every((row) => row.publishedAt !== null)).toBe(true);
  });

  it('writes no outbox row when the transaction rolls back', async () => {
    const dataSource = app.get(DataSource);
    let incidentId: string | undefined;

    const rolledBack = dataSource.transaction(async (manager) => {
      const saved = await persistIncident(
        manager,
        IncidentEntity.report(
          {
            // Fixed code: a sequence value is not given back on rollback.
            code: 'INC-ROLLBACK',
            type: 'medical',
            severity: 'low',
            title: 'Rolled back',
            zoneId: zone.id,
            lng: zone.center[0],
            lat: zone.center[1],
            source: 'operator',
            at: new Date(),
          },
          SystemActors.seed,
        ),
        IncidentEvents.Created,
      );
      incidentId = saved.id;
      // The row was really written, so it is the rollback that removes it.
      expect(await manager.countBy(OutboxEntity, { aggregateId: saved.id })).toBe(1);
      throw new Error('rollback');
    });

    await expect(rolledBack).rejects.toThrow('rollback');
    expect(incidentId).toBeDefined();
    const incidents = dataSource.getRepository(IncidentEntity);
    const outbox = dataSource.getRepository(OutboxEntity);
    expect(await incidents.countBy({ id: incidentId! })).toBe(0);
    expect(await outbox.countBy({ aggregateId: incidentId! })).toBe(0);
  });

  it('delivers a pending outbox row through the poll, without a nudge', async () => {
    const res = await api(app).get('/api/incidents?limit=1').expect(200);
    const incident = res.body[0] as Incident;
    const payload = { ...incident, version: incident.version + 100 };

    // Written straight to the table, so nothing nudges the relay: only the poll can deliver it.
    // That is what a restarted API finds after dying between commit and publish (ADR-0007).
    const delivered = waitFor(socket, IncidentEvents.Updated);
    const outbox = app.get(DataSource).getRepository(OutboxEntity);
    await outbox.insert(OutboxEntity.create(IncidentEvents.Updated, payload));

    expect(await delivered).toMatchObject({ id: payload.id, version: payload.version });
    // Already set: the event was only sent when the claim that marked the row committed.
    const [row] = await outbox.find({ order: { id: 'DESC' }, take: 1 });
    expect(row).toMatchObject({ aggregateId: payload.id });
    expect(row!.publishedAt).not.toBeNull();
  });

  it('rejects an invalid transition with 409', async () => {
    const res = await api(app).get('/api/incidents?status=resolved&limit=1').expect(200);

    const conflict = await api(app)
      .post(`/api/incidents/${res.body[0].id}/acknowledge`)
      .send({})
      .expect(409);
    expect(conflict.body).toMatchObject({ statusCode: 409, error: 'CONFLICT' });
  });

  it('validates input and returns 400 with field messages', async () => {
    const res = await api(app)
      .post('/api/incidents')
      .send({ type: 'alien_landing', severity: 'high', title: '', zoneId: zone.id, extra: 1 })
      .expect(400);

    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining('type'),
        expect.stringContaining('title'),
        expect.stringContaining('extra'),
      ]),
    );
  });

  // After the lifecycle case: each report here takes the next incident code.
  it('accepts every contract type and refuses an unknown one', async () => {
    // Every type, not one: the migration's literal list must match the contract's.
    for (const type of INCIDENT_TYPES) {
      const res = await api(app)
        .post('/api/incidents')
        .send({ type, severity: 'medium', title: `Every type: ${type}`, zoneId: zone.id });
      expect([type, res.status]).toEqual([type, 201]);
    }

    const unknown = await api(app)
      .post('/api/incidents')
      .send({ type: 'unknown', severity: 'medium', title: 'Not a type', zoneId: zone.id })
      .expect(400);
    expect(unknown.body.message).toEqual(expect.arrayContaining([expect.stringContaining('type')]));
  });

  it('allows a use only on a building, and only a known one', async () => {
    const db = app.get(DataSource);
    const setUse = (code: string, use: string | null) =>
      db.query(`UPDATE "zone" SET "use" = $2 WHERE "code" = $1`, [code, use]);
    const refused = { code: '23514', constraint: 'zone_use_check' };

    try {
      await expect(setUse('PRK-WEST', 'library')).rejects.toMatchObject(refused);
      await expect(setUse('BLD-LIB', 'garage')).rejects.toMatchObject(refused);

      // Not the seeded use, so the assertion shows the write.
      await setUse('BLD-LIB', 'academic');
      expect((await zonesByCode()).get('BLD-LIB')?.use).toBe('academic');
    } finally {
      // Later cases and a re-run of the seed expect the campus as seeded.
      await setUse('BLD-LIB', seededZone('BLD-LIB').use!);
    }
  });

  it('refuses a height that is not positive', async () => {
    const db = app.get(DataSource);
    const setHeight = (code: string, heightM: number | null) =>
      db.query(`UPDATE "zone" SET "height_m" = $2 WHERE "code" = $1`, [code, heightM]);
    const refused = { code: '23514', constraint: 'zone_height_check' };

    try {
      await expect(setHeight('BLD-LIB', 0)).rejects.toMatchObject(refused);
      await expect(setHeight('BLD-LIB', -1)).rejects.toMatchObject(refused);

      // Not the seeded height, so the assertion shows the write.
      await setHeight('BLD-LIB', 19);
      expect((await zonesByCode()).get('BLD-LIB')?.heightM).toBe(19);
    } finally {
      // Later cases and a re-run of the seed expect the campus as seeded.
      await setHeight('BLD-LIB', seededZone('BLD-LIB').heightM!);
    }
  });

  it('rejects a position outside the zone with 400 and creates nothing', async () => {
    const before = await api(app).get('/api/incidents?limit=200').expect(200);
    const north = Math.max(...zone.polygon.map(([, lat]) => lat));

    const res = await api(app)
      .post('/api/incidents')
      .send({
        type: 'medical',
        severity: 'low',
        title: 'Outside the library',
        zoneId: zone.id,
        position: [zone.center[0], north + 0.001],
      })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, error: 'BAD_REQUEST' });
    expect(res.body.message).toContain(zone.code);
    const after = await api(app).get('/api/incidents?limit=200').expect(200);
    expect(after.body).toHaveLength(before.body.length);
  });

  it('returns 404 for an unknown zone or incident', async () => {
    await api(app)
      .post('/api/incidents')
      .send({
        type: 'medical',
        severity: 'low',
        title: 'Test',
        zoneId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(404);
    await api(app).get('/api/incidents/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('resolves a camera stream through the configured source', async () => {
    const cameras = await api(app).get(`/api/cameras?zoneId=${zone.id}`).expect(200);
    const stream = await api(app).get(`/api/cameras/${cameras.body[0].id}/stream`).expect(200);

    expect(stream.body).toMatchObject({ kind: 'mock', label: 'CAM-L01 · Library entrance' });
  });

  it('tops up a campus seeded before the expanded zones and the site plan', async () => {
    const db = app.get(DataSource);
    const seed = app.get(SeedService);
    const custom: CameraFieldOfView = { heading: 45, angle: 30, range: 10 };
    const libraryFov = CAMERAS.find((camera) => camera.code === 'CAM-L01')!.fov;
    const hub = seededZone('BLD-HUB');
    const expandedCodes = ZONES.map((z) => z.code).filter(
      (code) => !REFERENCE_ZONE_CODES.includes(code),
    );
    // The twelve cameras of the first campus come first (`campus.spec.ts` pins the order).
    const newCameraCodes = CAMERAS.slice(12).map((camera) => camera.code);
    const setFov = (code: string, { heading, angle, range }: CameraFieldOfView) =>
      db.query(
        `UPDATE "camera" SET "fov_heading_deg" = $2, "fov_angle_deg" = $3, "fov_range_m" = $4
         WHERE "code" = $1`,
        [code, heading, angle, range],
      );
    const fieldsOfView = async () => {
      const res = await api(app).get('/api/cameras').expect(200);
      return new Map((res.body as Camera[]).map((camera) => [camera.code, camera.fieldOfView]));
    };

    try {
      // As seeded before V2-04.2 and ADR-0017: the nine first zones without a use or a height, no
      // site plan, the twelve first cameras without a field of view. Except what an operator set
      // since: one field of view, and the hub's use and height, which a top-up must keep.
      await db.query(`DELETE FROM "site"`);
      await db.query(
        `UPDATE "camera" SET "fov_heading_deg" = NULL, "fov_angle_deg" = NULL, "fov_range_m" = NULL`,
      );
      await setFov('CAM-L01', custom);
      // The new cameras go first: `camera.zone_id` restricts the deletion of the zones they sit on.
      await db.query(`DELETE FROM "camera" WHERE "code" = ANY($1)`, [newCameraCodes]);
      // So do the incidents: the history of V2-04.4 sits on the expanded zones, and `incident.zone_id`
      // restricts their deletion. A campus seeded before them had none; the timeline goes with them
      // (cascade). The history is seeded on an empty database only, so they do not come back.
      await db.query(
        `DELETE FROM "incident" WHERE "zone_id" IN (SELECT "id" FROM "zone" WHERE "code" = ANY($1))`,
        [expandedCodes],
      );
      await db.query(`DELETE FROM "zone" WHERE "code" = ANY($1)`, [expandedCodes]);
      await db.query(`UPDATE "zone" SET "use" = NULL, "height_m" = NULL`);
      await db.query(
        `UPDATE "zone" SET "use" = 'administration', "height_m" = 30 WHERE "code" = 'BLD-HUB'`,
      );
      const missing = await api(app).get('/api/site-plan').expect(404);
      expect(missing.body.message).toBe('Site plan was not found');

      // Not the reference campus: the seed's data does not belong here, so nothing is added.
      await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB-RENAMED' WHERE "code" = 'BLD-LIB'`);
      await seed.onApplicationBootstrap();
      await api(app).get('/api/site-plan').expect(404);
      for (const [code, fov] of await fieldsOfView()) {
        expect([code, fov]).toEqual([code, code === 'CAM-L01' ? custom : null]);
      }
      const untouched = await zonesByCode();
      expect(untouched.size).toBe(REFERENCE_ZONE_CODES.length);
      for (const z of untouched.values()) {
        const expected = z.code === 'BLD-HUB' ? ['administration', 30] : [null, null];
        expect([z.code, z.use, z.heightM]).toEqual([z.code, ...expected]);
      }

      // The reference campus: the plan and the zones come back, and only what is unknown is filled.
      await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB' WHERE "code" = 'BLD-LIB-RENAMED'`);
      await seed.onApplicationBootstrap();
      const plan = (await api(app).get('/api/site-plan').expect(200)).body as SitePlan;
      expect(plan.features).toHaveLength(7);
      const filled = await fieldsOfView();
      expect(filled.size).toBe(CAMERAS.length);
      for (const camera of CAMERAS) {
        const expected = camera.code === 'CAM-L01' ? custom : camera.fov;
        expect([camera.code, filled.get(camera.code)]).toEqual([camera.code, expected]);
      }

      const topped = await zonesByCode();
      expect(topped.size).toBe(ZONES.length);
      for (const seeded of ZONES) {
        const kept = seeded.code === hub.code;
        const z = topped.get(seeded.code);
        expect([seeded.code, z?.use, z?.heightM]).toEqual([
          seeded.code,
          kept ? 'administration' : (seeded.use ?? null),
          kept ? 30 : (seeded.heightM ?? null),
        ]);
      }

      // Nothing is left to add, so a further boot changes nothing.
      await seed.onApplicationBootstrap();
      expect([...(await zonesByCode()).entries()]).toEqual([...topped.entries()]);
      expect([...(await fieldsOfView()).entries()]).toEqual([...filled.entries()]);
    } finally {
      // Leave a complete campus for later cases, even if an assertion above failed. The hub's use
      // and height are put back by hand: a top-up keeps a value that is set.
      await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB' WHERE "code" = 'BLD-LIB-RENAMED'`);
      await db.query(`UPDATE "zone" SET "use" = $2, "height_m" = $3 WHERE "code" = $1`, [
        hub.code,
        hub.use,
        hub.heightM,
      ]);
      await setFov('CAM-L01', libraryFov);
      await seed.onApplicationBootstrap();
    }
  });

  it('adds the seed cameras a campus that otherwise looks complete lacks', async () => {
    const db = app.get(DataSource);
    const seed = app.get(SeedService);
    const custom: CameraFieldOfView = { heading: 45, angle: 30, range: 10 };
    const libraryFov = CAMERAS.find((camera) => camera.code === 'CAM-L01')!.fov;
    // The twelve cameras of the first campus come first (`campus.spec.ts` pins the order).
    const added = CAMERAS.slice(12);
    const kept = added.find((camera) => camera.code === 'CAM-R02')!;
    const setFov = (code: string, { heading, angle, range }: CameraFieldOfView) =>
      db.query(
        `UPDATE "camera" SET "fov_heading_deg" = $2, "fov_angle_deg" = $3, "fov_range_m" = $4
         WHERE "code" = $1`,
        [code, heading, angle, range],
      );
    const camerasByCode = async () => {
      const res = await api(app).get('/api/cameras').expect(200);
      return new Map((res.body as Camera[]).map((camera) => [camera.code, camera]));
    };

    try {
      // The site plan, every field of view and the zones are in place, so only cameras are missing:
      // the state of a volume seeded by V2-04.2. The previous case cannot prove the boot notices
      // that, as it also deletes the site plan and clears the fields of view. One new camera stays
      // and an operator changed it; a camera of the first campus has a view of its own.
      await db.query(`DELETE FROM "camera" WHERE "code" = ANY($1)`, [
        added.filter((camera) => camera !== kept).map((camera) => camera.code),
      ]);
      await db.query(
        `UPDATE "camera" SET "name" = 'Renamed by operator', "online" = false WHERE "code" = $1`,
        [kept.code],
      );
      await setFov('CAM-L01', custom);

      await seed.onApplicationBootstrap();

      const cameras = await camerasByCode();
      expect(cameras.size).toBe(CAMERAS.length);
      for (const camera of added) {
        const row = cameras.get(camera.code);
        const changed = camera === kept;
        expect([camera.code, row?.name, row?.online, row?.fieldOfView]).toEqual([
          camera.code,
          changed ? 'Renamed by operator' : camera.name,
          changed ? false : (camera.online ?? true),
          camera.fov,
        ]);
      }
      expect(cameras.get('CAM-L01')?.fieldOfView).toEqual(custom);

      // Nothing is left to add, so a further boot changes nothing.
      await seed.onApplicationBootstrap();
      expect([...(await camerasByCode()).entries()]).toEqual([...cameras.entries()]);
    } finally {
      // A top-up keeps a value that is set, so the operator's changes are put back by hand.
      await db.query(`UPDATE "camera" SET "name" = $2, "online" = $3 WHERE "code" = $1`, [
        kept.code,
        kept.name,
        kept.online ?? true,
      ]);
      await setFov('CAM-L01', libraryFov);
      await seed.onApplicationBootstrap();
    }
  });

  it('leaves a seed zone that was re-typed alone', async () => {
    const db = app.get(DataSource);
    const seed = app.get(SeedService);

    try {
      // An operator made the lab an outdoor zone: not a building, so no use. The hub's missing use
      // makes the boot run a top-up, which must fill the hub and leave the lab as it is
      // (`zone_use_check` would refuse a use on it and fail the boot).
      await db.query(
        `UPDATE "zone" SET "kind" = 'outdoor', "use" = NULL, "height_m" = NULL
         WHERE "code" = 'BLD-LAB'`,
      );
      await db.query(`UPDATE "zone" SET "use" = NULL WHERE "code" = 'BLD-HUB'`);

      await seed.onApplicationBootstrap();

      const zones = await zonesByCode();
      expect(zones.get('BLD-LAB')).toMatchObject({ kind: 'outdoor', use: null, heightM: null });
      expect(zones.get('BLD-HUB')?.use).toBe(seededZone('BLD-HUB').use);
    } finally {
      await db.query(`UPDATE "zone" SET "kind" = 'building' WHERE "code" = 'BLD-LAB'`);
      await seed.onApplicationBootstrap();
    }
  });

  /** Every route but health needs an access token; `/events` checks it at the handshake (ADR-0010). */
  describe('authentication', () => {
    it('rejects requests without a token (401) before validating them', async () => {
      const server = app.getHttpServer();
      const withoutToken = [
        request(server).get('/api/zones'),
        request(server).get('/api/cameras'),
        request(server).get('/api/incidents'),
        // An invalid body too: guards run before validation, so this is 401, not 400.
        request(server).post('/api/incidents').send({ type: 'alien_landing' }),
      ];
      for (const req of withoutToken) {
        const res = await req.expect(401);
        expect(res.headers['www-authenticate']).toBe('Bearer realm="occ"');
        expect(res.body).toMatchObject({
          statusCode: 401,
          error: 'UNAUTHORIZED',
          message: 'Missing bearer token',
        });
      }
    });

    it('rejects every token it cannot verify (401), without saying why', async () => {
      const rejected: [string, string][] = [
        ['another scheme', 'Basic abc'],
        ['no token', 'Bearer'],
        ['not a JWT', bearer('not-a-jwt')],
        ['expired', bearer(await signToken({ expiresIn: -120 }))],
        ['another audience', bearer(await signToken({ aud: 'another-api' }))],
        ['another issuer', bearer(await signToken({ iss: 'http://127.0.0.1/realms/other' }))],
        ['an unpublished key', bearer(await signToken({ key: 'other' }))],
        ['alg none', bearer(unsignedToken())],
        ['HS256', bearer(await hs256Token())],
        ['no subject', bearer(await signToken({ sub: null }))],
      ];
      for (const [label, authorization] of rejected) {
        const res = await request(app.getHttpServer())
          .get('/api/zones')
          .set('Authorization', authorization);
        // The label makes a failure say which token got through.
        expect([label, res.status]).toEqual([label, 401]);
        expect(res.headers['www-authenticate']).toBe('Bearer realm="occ", error="invalid_token"');
        expect(res.body.message).toBe('Invalid access token');
      }
    });

    it('leaves the health probes and the API docs open', async () => {
      const live = await request(app.getHttpServer()).get('/api/health/live').expect(200);
      expect(live.body).toEqual({ status: 'ok', info: {}, error: {}, details: {} });
      const ready = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
      expect(ready.body).toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' }, outbox_listener: { status: 'up' } },
      });

      // Swagger is served outside the Nest router, so the guard never sees it (ADR-0005 governs it).
      const docs = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
      expect(docs.body.components.securitySchemes.bearer).toMatchObject({
        type: 'http',
        scheme: 'bearer',
      });
    });

    it('refuses a socket without a valid token', async () => {
      for (const options of [{}, { auth: { token: 'not-a-jwt' } }]) {
        await expect(
          connectEvents(app, ['websocket'], { reconnection: false, ...options }),
        ).rejects.toThrow(EventsConnectErrors.Unauthorized);
      }
    });

    it('closes a socket when its token expires, and lets it reconnect with a fresh one', async () => {
      // A function, as the console passes it: called again on every reconnect.
      let handshakes = 0;
      const auth = (cb: (data: EventsHandshakeAuth) => void) => {
        handshakes += 1;
        const next = handshakes === 1 ? signToken({ expiresIn: 2 }) : Promise.resolve(token);
        void next.then((fresh) => cb({ token: fresh }));
      };
      const client = await connectEvents(app, ['websocket'], { auth });
      try {
        const disconnected = new Promise<string>((resolve) =>
          client.once('disconnect', (reason) => resolve(reason)),
        );
        const reconnected = new Promise<void>((resolve) => client.once('connect', () => resolve()));

        // A transport close, as on resync: the client reconnects by itself, with a fresh token.
        expect(await disconnected).toBe('transport close');
        await reconnected;
        expect(handshakes).toBe(2);
      } finally {
        client.close();
      }
    });
  });

  /** Every timeline entry records who caused it, and only the server decides who that is (ADR-0011). */
  describe('actors', () => {
    it('records the simulator as the actor of its changes', async () => {
      // Awaiting the broadcast keeps it from reaching a later `waitFor`.
      const created = waitFor(socket, IncidentEvents.Created);
      // `() => 0` is deterministic: no simulator incident exists yet, so the tick only reports one.
      await app.get(SimulatorService).tick(() => 0);
      const incident = await created;

      const detail = await api(app).get(`/api/incidents/${incident.id}`).expect(200);
      expect(detail.body.source).toBe('simulator');
      expect(detail.body.timeline.map((e: { actor: unknown }) => e.actor)).toEqual([
        SystemActors.simulator,
      ]);
    });

    it('never takes the actor from the request', async () => {
      const report = await api(app)
        .post('/api/incidents')
        .send({ type: 'medical', severity: 'low', title: 'Actor not from body', zoneId: zone.id })
        .expect(201);

      const spoofed = await api(app)
        .post(`/api/incidents/${report.body.id}/acknowledge`)
        .send({ actor: { kind: 'system', subject: 'spoof', displayName: 'Spoofed' } })
        .expect(400);
      expect(spoofed.body.message).toEqual([expect.stringContaining('actor')]);

      const detail = await api(app).get(`/api/incidents/${report.body.id}`).expect(200);
      expect(detail.body).toMatchObject({ status: 'open', version: 1 });
      expect(detail.body.timeline.map((e: { actor: unknown }) => e.actor)).toEqual([
        OPERATOR_ACTOR,
      ]);
    });
  });

  /**
   * What each role may do: viewers read, operators and supervisors also write (ADR-0011), and a
   * technician acknowledges and resolves only Facilities and Environment incidents (ADR-0021).
   */
  describe('roles', () => {
    let viewer: string;
    let technician: string;
    const typedBody = (type: IncidentType, title: string) => ({
      type,
      severity: 'low',
      title,
      zoneId: zone.id,
    });
    const newBody = (title: string) => typedBody('medical', title);
    /** `fire_alarm` is out of a technician's scope (Fire & safety), `water_leak` in it (Facilities). */
    const SPLIT_TYPES = ['fire_alarm', 'water_leak'] as const;
    const transition = (
      withToken: string,
      id: string,
      action: 'acknowledge' | 'resolve',
      body: object = {},
    ) => api(app, withToken).post(`/api/incidents/${id}/${action}`).send(body);

    beforeAll(async () => {
      viewer = await signToken({ sub: 'e2e-viewer', name: 'E2E Viewer', roles: ['viewer'] });
      technician = await signToken({
        sub: 'e2e-technician',
        name: 'E2E Technician',
        roles: ['technician'],
      });
    });

    it('lets a viewer read but not report, acknowledge or resolve (403)', async () => {
      // In and out of a technician's scope alike: a viewer's 403 comes from the guard.
      for (const type of SPLIT_TYPES) {
        const target = await reportIncident(app, typedBody(type, 'Viewer target')).expect(201);
        const id = target.body.id as string;

        const writes: [string, request.Test][] = [
          [
            'incident:report',
            reportIncident(app, typedBody(type, 'Viewer target'), undefined, viewer),
          ],
          ['incident:acknowledge', transition(viewer, id, 'acknowledge')],
          ['incident:resolve', transition(viewer, id, 'resolve')],
        ];
        for (const [permission, req] of writes) {
          const res = await req;
          // The type and permission make a failure say which write got through.
          expect([type, permission, res.status]).toEqual([type, permission, 403]);
          expect(res.body).toMatchObject({
            statusCode: 403,
            error: 'FORBIDDEN',
            message: `Missing permission: ${permission}`,
          });
        }

        const after = await api(app).get(`/api/incidents/${id}`).expect(200);
        expect(after.body).toMatchObject({ status: 'open', version: 1 });
      }
      expect(await countIncidents(app, 'Viewer target')).toBe(SPLIT_TYPES.length);
    });

    it('lets a viewer read everything and listen to /events', async () => {
      await api(app, viewer).get('/api/zones').expect(200);
      await api(app, viewer).get('/api/site-plan').expect(200);
      const cameras = await api(app, viewer).get('/api/cameras').expect(200);
      await api(app, viewer).get(`/api/cameras/${cameras.body[0].id}/stream`).expect(200);
      const incidents = await api(app, viewer).get('/api/incidents').expect(200);
      await api(app, viewer).get(`/api/incidents/${incidents.body[0].id}`).expect(200);

      const client = await connectEvents(app, ['websocket'], {
        reconnection: false,
        auth: { token: viewer },
      });
      try {
        expect(client.connected).toBe(true);
      } finally {
        client.close();
      }
    });

    it('refuses a user with no known role (403, socket Forbidden)', async () => {
      const cases: [string, string[] | null][] = [
        ['no realm_access', null],
        ['unknown role only', ['admin']],
      ];
      for (const [label, roles] of cases) {
        const roleless = await signToken({ sub: 'e2e-roleless', roles });
        const requests = [
          api(app, roleless).get('/api/zones'),
          api(app, roleless).get('/api/site-plan'),
          reportIncident(app, newBody('Role-less'), undefined, roleless),
        ];
        for (const req of requests) {
          const res = await req;
          expect([label, res.status]).toEqual([label, 403]);
          expect(res.body.message).toBe('No role grants access to this API');
        }
        await expect(
          connectEvents(app, ['websocket'], { reconnection: false, auth: { token: roleless } }),
        ).rejects.toThrow(EventsConnectErrors.Forbidden);
      }
      expect(await countIncidents(app, 'Role-less')).toBe(0);
    });

    it('answers a viewer 403 before validating the request or finding the incident', async () => {
      // Guards run before pipes: not 400 for the body, not 404 for the id.
      await reportIncident(app, { type: 'alien_landing' }, undefined, viewer).expect(403);
      await api(app, viewer)
        .post('/api/incidents/00000000-0000-4000-8000-000000000000/acknowledge')
        .send({})
        .expect(403);
    });

    it('lets a supervisor act like an operator', async () => {
      const supervisor = await signToken({
        sub: 'e2e-supervisor',
        name: 'E2E Supervisor',
        roles: ['supervisor'],
      });
      const target = await reportIncident(app, newBody('Supervisor target')).expect(201);

      const ack = await api(app, supervisor)
        .post(`/api/incidents/${target.body.id}/acknowledge`)
        .send({})
        .expect(200);
      expect(ack.body.timeline.at(-1)).toMatchObject({
        kind: 'acknowledged',
        actor: { kind: 'user', subject: 'e2e-supervisor', displayName: 'E2E Supervisor' },
      });
    });

    // ADR-0021 § Proving it.
    it("scopes a technician's acknowledge and resolve to facilities and environment", async () => {
      // Reporting is never scoped.
      const fireAlarm = await reportIncident(
        app,
        typedBody('fire_alarm', 'Technician fire alarm'),
        undefined,
        technician,
      ).expect(201);
      const fireAlarmId = fireAlarm.body.id as string;

      for (const action of ['acknowledge', 'resolve'] as const) {
        const res = await transition(technician, fireAlarmId, action);
        expect([action, res.status]).toEqual([action, 403]);
        expect(res.body).toMatchObject({
          statusCode: 403,
          error: 'FORBIDDEN',
          message: 'Not allowed for this category',
        });
      }
      const untouched = await api(app).get(`/api/incidents/${fireAlarmId}`).expect(200);
      expect(untouched.body).toMatchObject({ status: 'open', version: 1 });

      const leak = await reportIncident(app, typedBody('water_leak', 'Technician leak')).expect(
        201,
      );
      const ack = await transition(technician, leak.body.id, 'acknowledge').expect(200);
      expect(ack.body.status).toBe('acknowledged');
      expect(ack.body.timeline.at(-1)).toMatchObject({
        kind: 'acknowledged',
        actor: { kind: 'user', subject: 'e2e-technician', displayName: 'E2E Technician' },
      });
      const resolved = await transition(technician, leak.body.id, 'resolve').expect(200);
      expect(resolved.body.status).toBe('resolved');
    });

    it('answers a technician 403, not 409, on a resolved incident outside its scope', async () => {
      const intrusion = await reportIncident(
        app,
        typedBody('intrusion', 'Resolved intrusion'),
      ).expect(201);
      await transition(token, intrusion.body.id, 'resolve').expect(200);

      const res = await transition(technician, intrusion.body.id, 'resolve').expect(403);
      expect(res.body.message).toBe('Not allowed for this category');
    });

    it('checks the category after validating the request and finding the incident', async () => {
      // 404, not 403: the category is unknown until the incident is loaded.
      await transition(technician, '00000000-0000-4000-8000-000000000000', 'acknowledge').expect(
        404,
      );

      const fireAlarm = await reportIncident(
        app,
        typedBody('fire_alarm', 'Order of answers'),
      ).expect(201);
      // 400, not 403: pipes run before the service.
      const invalid = await transition(technician, fireAlarm.body.id, 'acknowledge', {
        note: 123,
      }).expect(400);
      // `@MaxLength` also reports on a non-string, so the type error is one message of several.
      expect(invalid.body.message).toEqual(expect.arrayContaining(['note must be a string']));
    });

    it('lets operators and supervisors act on every category', async () => {
      const supervisor = await signToken({ sub: 'e2e-supervisor', roles: ['supervisor'] });
      const actors: [string, string][] = [
        ['operator', token],
        ['supervisor', supervisor],
      ];

      for (const [role, withToken] of actors) {
        for (const type of SPLIT_TYPES) {
          const target = await reportIncident(
            app,
            typedBody(type, `${role} acts on ${type}`),
          ).expect(201);
          const res = await transition(withToken, target.body.id, 'acknowledge');
          expect([role, type, res.status]).toEqual([role, type, 200]);
        }
      }
    });

    // The simulator passes `'system'`, which no request can choose, and acts on every type.
    it("does not scope the API's own transitions", async () => {
      const fireAlarm = await reportIncident(
        app,
        typedBody('fire_alarm', 'System transitions'),
      ).expect(201);
      const incidents = app.get(IncidentsService);

      await incidents.acknowledge(fireAlarm.body.id, SystemActors.simulator, 'system');
      const resolved = await incidents.resolve(fireAlarm.body.id, SystemActors.simulator, 'system');

      expect(resolved.status).toBe('resolved');
      expect(resolved.timeline.map((entry) => entry.actor)).toEqual([
        OPERATOR_ACTOR,
        SystemActors.simulator,
        SystemActors.simulator,
      ]);
    });
  });

  /** Retries of `POST /api/incidents` with the same key create one incident (ADR-0009). */
  describe('with an Idempotency-Key', () => {
    const newBody = (title: string) => ({
      type: 'medical',
      severity: 'low',
      title,
      zoneId: zone.id,
    });

    it('replays the first response for a retry with the same key', async () => {
      const key = randomUUID();
      const title = 'Idem replay';

      const first = await reportIncident(app, newBody(title), key).expect(201);
      const second = await reportIncident(app, newBody(title), key).expect(201);
      // `json` storage keeps key order, so the replay is byte-identical, not just equal.
      expect(second.text).toBe(first.text);

      // Same values, keys in another order: the fingerprint ignores order.
      const reordered = { zoneId: zone.id, title, severity: 'low', type: 'medical' };
      const third = await reportIncident(app, reordered, key).expect(201);
      expect(third.text).toBe(first.text);

      expect(await countIncidents(app, title)).toBe(1);
      // The gateway only broadcasts outbox rows, so one row means one `incident.created`.
      const outbox = await app
        .get(DataSource)
        .getRepository(OutboxEntity)
        .find({ where: { aggregateId: first.body.id } });
      expect(outbox.map((row) => row.event)).toEqual([IncidentEvents.Created]);
    });

    it('creates one incident for concurrent requests with the same key', async () => {
      const key = randomUUID();
      const title = 'Idem concurrent';

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => reportIncident(app, newBody(title), key)),
      );

      expect(responses.map((res) => res.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(responses.map((res) => res.text)).size).toBe(1);
      expect(await countIncidents(app, title)).toBe(1);
    });

    it('rejects the same key with a different body (422)', async () => {
      const key = randomUUID();
      await reportIncident(app, newBody('Idem original'), key).expect(201);

      const reused = await reportIncident(app, newBody('Idem changed'), key).expect(422);
      expect(reused.body).toMatchObject({ statusCode: 422, error: 'UNPROCESSABLE_ENTITY' });
      expect(reused.body.message).toContain('Idempotency-Key');
      expect(reused.body.message).not.toContain(key); // client input is not echoed back
      expect(await countIncidents(app, 'Idem changed')).toBe(0);
    });

    it('rejects a malformed key (400)', async () => {
      const title = 'Idem malformed';
      for (const key of ['has space', 'k'.repeat(256)]) {
        const res = await reportIncident(app, newBody(title), key).expect(400);
        expect(res.body.message).toEqual([expect.stringContaining('Idempotency-Key')]);
      }
      expect(await countIncidents(app, title)).toBe(0);
    });

    it('lets a failed request be retried with the same key', async () => {
      const key = randomUUID();
      const title = 'Idem after 404';
      const unknownZone = '00000000-0000-4000-8000-000000000000';

      // The 404 rolls back the key with everything else, so it is free for the corrected retry.
      await reportIncident(app, { ...newBody(title), zoneId: unknownZone }, key).expect(404);
      await reportIncident(app, newBody(title), key).expect(201);
      expect(await countIncidents(app, title)).toBe(1);
    });

    it('treats an expired key as new', async () => {
      const key = randomUUID();
      const first = await reportIncident(app, newBody('Idem before expiry'), key).expect(201);

      await app
        .get(DataSource)
        .query(
          `UPDATE "idempotency_key" SET "expires_at" = now() - interval '1 second' WHERE "key" = $1`,
          [key],
        );

      // A different body would be a 422 on a live key; on an expired one it is a new request.
      const second = await reportIncident(app, newBody('Idem after expiry'), key).expect(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect(await countIncidents(app, 'Idem after expiry')).toBe(1);
    });

    it('keeps keys per user', async () => {
      const key = randomUUID();
      const title = 'Idem per user';
      const [asA, asB] = await Promise.all([
        signToken({ sub: 'e2e-user-a' }),
        signToken({ sub: 'e2e-user-b' }),
      ]);

      // The same key from another user is another key, not a replay of someone else's response.
      const first = await reportIncident(app, newBody(title), key, asA).expect(201);
      const second = await reportIncident(app, newBody(title), key, asB).expect(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect(await countIncidents(app, title)).toBe(2);
    });
  });

  /**
   * A second application on the same database, as a second API replica would be (ADR-0008). Each
   * app has its own event bus, relay, listener and simulator leader, so the only path between the
   * two is PostgreSQL.
   */
  describe('with a second instance', () => {
    let appB: INestApplication;
    let socketB: EventsSocket;

    beforeAll(async () => {
      // A's relay publishes after the response, so an earlier case's `created` can still be in
      // flight. Announced after B starts listening, it would be the first event B sees.
      await app.get(OutboxRelay).drain();
      // B finds the schema migrated and the campus seeded, so it does neither.
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      appB = configureApp(moduleRef.createNestApplication());
      await appB.listen(0);
      socketB = await connectEvents(appB, ['websocket'], { auth: { token } });
    });

    afterAll(async () => {
      socketB?.disconnect();
      await appB?.close();
    });

    it('fans an event out to a client on another instance, exactly once', async () => {
      const createdOnB: Incident[] = [];
      const record = (incident: Incident) => void createdOnB.push(incident);
      socketB.on(IncidentEvents.Created, record);
      try {
        const onB = waitFor(socketB, IncidentEvents.Created);
        const onA = waitFor(socket, IncidentEvents.Created);
        const report = await api(app)
          .post('/api/incidents')
          .send({
            type: 'medical',
            severity: 'medium',
            title: 'Reported through A',
            zoneId: zone.id,
          })
          .expect(201);
        expect(await onB).toMatchObject({ id: report.body.id, version: 1 });
        expect(await onA).toMatchObject({ id: report.body.id, version: 1 });

        // A listener delivers batches one at a time in commit order, so a duplicate `created`
        // would reach B before this later update does.
        const acknowledged = waitFor(socketB, IncidentEvents.Updated);
        await api(app).post(`/api/incidents/${report.body.id}/acknowledge`).send({}).expect(200);
        expect(await acknowledged).toMatchObject({ id: report.body.id, version: 2 });
        expect(createdOnB.filter((incident) => incident.id === report.body.id)).toHaveLength(1);
      } finally {
        socketB.off(IncidentEvents.Created, record);
      }
    });

    it('elects exactly one simulator leader and fails over on release', async () => {
      // The simulator timer is off in e2e, so only these calls take the lock. B's close() gives
      // up its lead; A's leader stays stopped, which nothing else in the suite needs.
      const leaderA = app.get(SimulatorLeader);
      const leaderB = appB.get(SimulatorLeader);

      expect(await leaderA.isLeader()).toBe(true);
      expect(await leaderB.isLeader()).toBe(false);
      await leaderA.release();
      expect(await leaderB.isLeader()).toBe(true);
    });

    it('makes clients on an instance reconnect when its listener resyncs', async () => {
      const disconnected = new Promise<string>((resolve) =>
        socketB.once('disconnect', (reason) => resolve(reason)),
      );
      const reconnected = new Promise<void>((resolve) => socketB.once('connect', () => resolve()));

      // What B's listener emits after its LISTEN connection comes back (ADR-0008).
      appB.get(EventEmitter2).emit(OutboxEvents.Resynced);

      // A transport close, not a server disconnect: only then does the client reconnect by itself.
      expect(await disconnected).toBe('transport close');
      await reconnected;
      expect(socketB.connected).toBe(true);
      expect(socket.connected).toBe(true); // A's clients are not affected
    });

    it('refuses long-polling clients', async () => {
      // With a valid token and role, so the refusal can only be about the transport, not about
      // authentication or authorization.
      const refused = await connectEvents(appB, ['polling'], {
        reconnection: false,
        auth: { token },
      }).then(
        () => undefined,
        (error: Error) => error,
      );
      expect(refused).toBeInstanceOf(Error);
      expect(refused?.message).not.toBe(EventsConnectErrors.Unauthorized);
      expect(refused?.message).not.toBe(EventsConnectErrors.Forbidden);
    });

    it('creates one incident when instances race on the same key', async () => {
      const key = randomUUID();
      const title = 'Idem across instances';
      const body = { type: 'medical', severity: 'low', title, zoneId: zone.id };

      // The claim is a primary-key insert in PostgreSQL, so it excludes across replicas (ADR-0009).
      const responses = await Promise.all(
        [app, appB, app, appB].map((target) => reportIncident(target, body, key)),
      );

      expect(responses.map((res) => res.status)).toEqual([201, 201, 201, 201]);
      expect(new Set(responses.map((res) => res.text)).size).toBe(1);
      expect(await countIncidents(app, title)).toBe(1);
    });
  });

  /**
   * Keycloak down: the API keeps running but cannot check any token (ADR-0010). App C uses the
   * real `TokenVerifier`, pointed at a port nothing listens on.
   */
  describe('with the identity provider unreachable', () => {
    let appC: INestApplication;

    beforeAll(async () => {
      const deadJwksUrl = `http://127.0.0.1:${await unusedPort()}/certs`;
      const config = {
        get: (name: keyof Env) => (name === 'OIDC_JWKS_URL' ? deadJwksUrl : process.env[name]),
      } as unknown as ConfigService<Env, true>;
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(TokenVerifier)
        .useValue(new TokenVerifier(config))
        .compile();
      appC = configureApp(moduleRef.createNestApplication());
      await appC.listen(0);
    });

    afterAll(async () => {
      await appC?.close();
    });

    it('answers 503 on REST and refuses sockets while it cannot fetch signing keys', async () => {
      // 503, not 401: signing in again cannot help, so the console must not send the user there.
      const res = await api(appC).get('/api/zones').expect(503);
      expect(res.body).toMatchObject({ statusCode: 503, message: 'Identity provider unavailable' });

      await expect(
        connectEvents(appC, ['websocket'], { reconnection: false, auth: { token } }),
      ).rejects.toThrow(EventsConnectErrors.IdentityProviderUnavailable);
    });
  });
});

/** The suite drops the whole schema: refuse any database whose name does not end in `_test`. */
function assertTestDatabase(name: string): void {
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to drop schema "public" in database "${name}": e2e needs a *_test database.`,
    );
  }
}

/** A supertest agent for `target` that sends `withToken` as the bearer token on every request. */
function api(target: INestApplication, withToken = token): ReturnType<typeof request.agent> {
  return request.agent(target.getHttpServer()).set('Authorization', bearer(withToken));
}

/** `POST /api/incidents` on `target`, with an `Idempotency-Key` when `key` is given. */
function reportIncident(
  target: INestApplication,
  body: object,
  key?: string,
  withToken = token,
): request.Test {
  const req = api(target, withToken).post('/api/incidents');
  if (key !== undefined) req.set(IDEMPOTENCY_KEY_HEADER, key);
  return req.send(body);
}

/** A loopback port nothing listens on: bound once, then released. */
async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function countIncidents(target: INestApplication, title: string): Promise<number> {
  return target.get(DataSource).getRepository(IncidentEntity).countBy({ title });
}

type EventsSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Connects to an app's `/events` namespace. Rejects, and closes the client, if refused. */
async function connectEvents(
  target: INestApplication,
  transports: ('websocket' | 'polling')[],
  options: Partial<ManagerOptions & SocketOptions> = {},
): Promise<EventsSocket> {
  const url = (await target.getUrl()).replace('[::1]', 'localhost');
  const client: EventsSocket = io(`${url}${EVENTS_NAMESPACE}`, { transports, ...options });
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client));
    client.once('connect_error', (error) => {
      client.close();
      reject(error);
    });
  });
}

function waitFor<E extends keyof ServerToClientEvents>(
  socket: Socket<ServerToClientEvents, ClientToServerEvents>,
  event: E,
): Promise<Incident> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5000);
    socket.once(
      event as never,
      ((incident: Incident) => {
        clearTimeout(timer);
        resolve(incident);
      }) as never,
    );
  });
}
