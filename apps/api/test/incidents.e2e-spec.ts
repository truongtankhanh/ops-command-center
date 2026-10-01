import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  type Incident,
  IncidentEvents,
  type ServerToClientEvents,
  type Zone,
} from '@occ/contracts';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

/**
 * Runs the real application against a real PostgreSQL database (`DATABASE_URL`).
 * The schema is dropped and rebuilt through migrations, then the reference campus is seeded.
 */
describe('Incidents (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  let zone: Zone;

  beforeAll(async () => {
    process.env.SEED_ON_BOOT = 'true';
    process.env.SIMULATOR_ENABLED = 'false';
    process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/ops_test';

    // Start from an empty schema so migrations and seed run exactly as on a fresh install.
    const admin = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
    }).initialize();
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
    });
    expect((await created).id).toBe(report.body.id);

    const acknowledged = waitFor(socket, IncidentEvents.Updated);
    await request(app.getHttpServer())
      .post(`/api/incidents/${report.body.id}/acknowledge`)
      .send({ note: 'Medic on the way' })
      .expect(200);
    expect((await acknowledged).status).toBe('acknowledged');

    const resolved = waitFor(socket, IncidentEvents.Updated);
    const done = await request(app.getHttpServer())
      .post(`/api/incidents/${report.body.id}/resolve`)
      .send({})
      .expect(200);
    expect((await resolved).status).toBe('resolved');

    expect(done.body.timeline.map((e: { kind: string }) => e.kind)).toEqual([
      'reported',
      'acknowledged',
      'resolved',
    ]);
    expect(done.body.timeline[1].note).toBe('Medic on the way');
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
});

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
