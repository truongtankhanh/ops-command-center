import { randomUUID } from 'node:crypto';
import { type AddressInfo, createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import {
  type Camera,
  type CameraFieldOfView,
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type EventsHandshakeAuth,
  IDEMPOTENCY_KEY_HEADER,
  INCIDENT_TYPES,
  type Incident,
  IncidentEvents,
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
import { CAMERAS } from '../src/database/seed/campus';
import { SeedService } from '../src/database/seed/seed.service';
import { SystemActors } from '../src/incidents/actors';
import { IncidentEntity } from '../src/incidents/incident.entity';
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
 * Runs the real application against a real PostgreSQL database (`DATABASE_URL` from `.env.test`
 * or the shell; its name must end in `_test`). The schema is dropped and rebuilt through
 * migrations, then the reference campus is seeded.
 */
describe('Incidents (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  let zone: Zone;

  beforeAll(async () => {
    // Start from an empty schema so migrations and seed run exactly as on a fresh install.
    const { DATABASE_URL } = validateEnv(process.env);
    assertTestDatabase(DATABASE_URL);
    const admin = await new DataSource({ type: 'postgres', url: DATABASE_URL }).initialize();
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

    expect(zones.body).toHaveLength(9);
    expect(cameras.body).toHaveLength(12);
    expect(incidents.body).toHaveLength(5);

    // No zone has a use until the seed sets them (V2-04.2); `null`, not missing, so the key is sent.
    for (const z of zones.body as Zone[]) expect([z.code, z.use]).toEqual([z.code, null]);

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
    // Nobody listens while seeding, so the seed announces nothing (ADR-0007).
    expect(await app.get(DataSource).getRepository(OutboxEntity).count()).toBe(0);

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
      code: 'INC-000006',
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

      await setUse('BLD-LIB', 'library');
      const zones = (await api(app).get('/api/zones').expect(200)).body as Zone[];
      expect(zones.find((z) => z.code === 'BLD-LIB')?.use).toBe('library');
    } finally {
      // Later cases and a re-run of the seed expect the campus as seeded.
      await setUse('BLD-LIB', null);
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

  it('tops up a campus seeded before the site plan and camera fields of view', async () => {
    const db = app.get(DataSource);
    const seed = app.get(SeedService);
    const custom: CameraFieldOfView = { heading: 45, angle: 30, range: 10 };
    const libraryFov = CAMERAS.find((camera) => camera.code === 'CAM-L01')!.fov;
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
      // As seeded before ADR-0017: no site plan, no fields of view, except one an operator set since.
      await db.query(`DELETE FROM "site"`);
      await db.query(
        `UPDATE "camera" SET "fov_heading_deg" = NULL, "fov_angle_deg" = NULL, "fov_range_m" = NULL`,
      );
      await setFov('CAM-L01', custom);
      const missing = await api(app).get('/api/site-plan').expect(404);
      expect(missing.body.message).toBe('Site plan was not found');

      // Not the reference campus: the seed's data does not belong here, so nothing is added.
      await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB-RENAMED' WHERE "code" = 'BLD-LIB'`);
      await seed.onApplicationBootstrap();
      await api(app).get('/api/site-plan').expect(404);
      for (const [code, fov] of await fieldsOfView()) {
        expect([code, fov]).toEqual([code, code === 'CAM-L01' ? custom : null]);
      }

      // The reference campus: the plan comes back, and only unknown fields of view are filled in.
      await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB' WHERE "code" = 'BLD-LIB-RENAMED'`);
      await seed.onApplicationBootstrap();
      const plan = (await api(app).get('/api/site-plan').expect(200)).body as SitePlan;
      expect(plan.features).toHaveLength(7);
      const filled = await fieldsOfView();
      for (const camera of CAMERAS) {
        const expected = camera.code === 'CAM-L01' ? custom : camera.fov;
        expect([camera.code, filled.get(camera.code)]).toEqual([camera.code, expected]);
      }
    } finally {
      // Leave a complete campus for later cases, even if an assertion above failed.
      await db.query(`UPDATE "zone" SET "code" = 'BLD-LIB' WHERE "code" = 'BLD-LIB-RENAMED'`);
      await setFov('CAM-L01', libraryFov);
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

  /** What each role may do: viewers read, operators and supervisors also write (ADR-0011). */
  describe('roles', () => {
    let viewer: string;
    const newBody = (title: string) => ({
      type: 'medical',
      severity: 'low',
      title,
      zoneId: zone.id,
    });

    beforeAll(async () => {
      viewer = await signToken({ sub: 'e2e-viewer', name: 'E2E Viewer', roles: ['viewer'] });
    });

    it('lets a viewer read but not report, acknowledge or resolve (403)', async () => {
      const target = await reportIncident(app, newBody('Viewer target')).expect(201);
      const id = target.body.id as string;

      const writes: [string, request.Test][] = [
        ['incident:report', reportIncident(app, newBody('Viewer target'), undefined, viewer)],
        [
          'incident:acknowledge',
          api(app, viewer).post(`/api/incidents/${id}/acknowledge`).send({}),
        ],
        ['incident:resolve', api(app, viewer).post(`/api/incidents/${id}/resolve`).send({})],
      ];
      for (const [permission, req] of writes) {
        const res = await req;
        // The permission makes a failure say which write got through.
        expect([permission, res.status]).toEqual([permission, 403]);
        expect(res.body).toMatchObject({
          statusCode: 403,
          error: 'FORBIDDEN',
          message: `Missing permission: ${permission}`,
        });
      }

      const after = await api(app).get(`/api/incidents/${id}`).expect(200);
      expect(after.body).toMatchObject({ status: 'open', version: 1 });
      expect(await countIncidents(app, 'Viewer target')).toBe(1);
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
function assertTestDatabase(databaseUrl: string): void {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
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
