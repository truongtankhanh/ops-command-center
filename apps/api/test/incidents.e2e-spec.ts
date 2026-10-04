import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import {
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  type Incident,
  IncidentEvents,
  type ServerToClientEvents,
  type Zone,
} from '@occ/contracts';
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validateEnv } from '../src/config/env.validation';
import { configureApp } from '../src/configure-app';
import { IncidentEntity } from '../src/incidents/incident.entity';
import { persistIncident } from '../src/incidents/persist-incident';
import { OutboxEvents } from '../src/outbox/outbox-events';
import { OutboxEntity } from '../src/outbox/outbox.entity';
import { SimulatorLeader } from '../src/simulator/simulator-leader.service';

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

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0);
    baseUrl = await app.getUrl();

    socket = io(`${baseUrl.replace('[::1]', 'localhost')}${EVENTS_NAMESPACE}`, {
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

    const zones = await request(app.getHttpServer()).get('/api/zones').expect(200);
    zone = (zones.body as Zone[]).find((z) => z.code === 'BLD-LIB')!;
  });

  afterAll(async () => {
    socket?.disconnect();
    await app?.close();
  });

  it('seeds the reference campus on an empty database', async () => {
    const zones = await request(app.getHttpServer()).get('/api/zones').expect(200);
    const cameras = await request(app.getHttpServer()).get('/api/cameras').expect(200);
    const incidents = await request(app.getHttpServer()).get('/api/incidents').expect(200);

    expect(zones.body).toHaveLength(9);
    expect(cameras.body).toHaveLength(12);
    expect(incidents.body).toHaveLength(5);
    // Nobody listens while seeding, so the seed announces nothing (ADR-0007).
    expect(await app.get(DataSource).getRepository(OutboxEntity).count()).toBe(0);
  });

  it('orders incidents unresolved first, then by severity', async () => {
    const res = await request(app.getHttpServer()).get('/api/incidents').expect(200);
    const statuses = (res.body as Incident[]).map((i) => i.status);
    const firstResolved = statuses.indexOf('resolved');

    expect(statuses.slice(firstResolved).every((s) => s === 'resolved')).toBe(true);
    expect((res.body as Incident[])[0]!.severity).toBe('high');
  });

  it('filters by status and severity', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/incidents?status=resolved&severity=critical')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ status: 'resolved', severity: 'critical' });
  });

  it('runs the full lifecycle and broadcasts every change', async () => {
    const created = waitFor(socket, IncidentEvents.Created);
    const report = await request(app.getHttpServer())
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
    const ack = await request(app.getHttpServer())
      .post(`/api/incidents/${report.body.id}/acknowledge`)
      .send({ note: 'Medic on the way' })
      .expect(200);
    expect(ack.body.version).toBe(2);
    expect(await acknowledged).toMatchObject({ status: 'acknowledged', version: 2 });

    const resolved = waitFor(socket, IncidentEvents.Updated);
    const done = await request(app.getHttpServer())
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
        IncidentEntity.report({
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
        }),
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
    const res = await request(app.getHttpServer()).get('/api/incidents?limit=1').expect(200);
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
    const res = await request(app.getHttpServer())
      .get('/api/incidents?status=resolved&limit=1')
      .expect(200);

    const conflict = await request(app.getHttpServer())
      .post(`/api/incidents/${res.body[0].id}/acknowledge`)
      .send({})
      .expect(409);
    expect(conflict.body).toMatchObject({ statusCode: 409, error: 'CONFLICT' });
  });

  it('validates input and returns 400 with field messages', async () => {
    const res = await request(app.getHttpServer())
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

  it('returns 404 for an unknown zone or incident', async () => {
    await request(app.getHttpServer())
      .post('/api/incidents')
      .send({
        type: 'medical',
        severity: 'low',
        title: 'Test',
        zoneId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/incidents/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });

  it('resolves a camera stream through the configured source', async () => {
    const cameras = await request(app.getHttpServer())
      .get(`/api/cameras?zoneId=${zone.id}`)
      .expect(200);
    const stream = await request(app.getHttpServer())
      .get(`/api/cameras/${cameras.body[0].id}/stream`)
      .expect(200);

    expect(stream.body).toMatchObject({ kind: 'mock', label: 'CAM-L01 · Library entrance' });
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
      // B finds the schema migrated and the campus seeded, so it does neither.
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      appB = configureApp(moduleRef.createNestApplication());
      await appB.listen(0);
      socketB = await connectEvents(appB, ['websocket']);
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
        const report = await request(app.getHttpServer())
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
        await request(app.getHttpServer())
          .post(`/api/incidents/${report.body.id}/acknowledge`)
          .send({})
          .expect(200);
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
      await expect(connectEvents(appB, ['polling'], { reconnection: false })).rejects.toThrow();
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
