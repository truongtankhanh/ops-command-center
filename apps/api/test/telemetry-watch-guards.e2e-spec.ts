// First: rate limits must be on before `AppModule` loads (see the file for why).
import './support/enable-rate-limits';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  TELEMETRY_NAMESPACE,
  type TelemetryClientToServerEvents,
  TelemetryEvents,
  type TelemetryServerToClientEvents,
} from '@occ/contracts';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validateEnv } from '../src/config/env.validation';
import { TelemetryIngestService } from '../src/telemetry/ingest/telemetry-ingest.service';
import { assertTestDatabase, eventually, startApp } from './support/app';
import { signToken } from './support/tokens';

type TelemetrySocket = Socket<TelemetryServerToClientEvents, TelemetryClientToServerEvents>;

/**
 * `telemetry.watch` through the global guards with rate limits **on** (ADR-0019, ADR-0012). It is
 * its own file because the flag is read once, when `AppModule` loads, and every other telemetry
 * suite runs with limits off: with them off, a socket message that `ThrottlerGuard` mishandled
 * would pass unnoticed. The `off` source is enough: a watch needs the catalogue, not readings.
 *
 * What it guards against: the handler is `@Public()` and `@SkipThrottle()`. Without the second,
 * `ThrottlerGuard` runs for a socket message, finds no user to key on, counts every console
 * against one shared bucket and writes a `throttler_hit` row per message.
 */
describe('telemetry.watch with rate limits on (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  const sockets: TelemetrySocket[] = [];

  beforeAll(async () => {
    assertTestDatabase(validateEnv(process.env).DB_NAME);
    // Migrates and seeds, so the second app finds the catalogue at its first read.
    await (await startApp(AppModule)).close();
    app = await startApp(AppModule);
    db = app.get(DataSource);
    const ingest = app.get(TelemetryIngestService);
    await eventually(
      () => ingest.knows('CT-01'),
      (known) => known,
      'the catalogue in the ingest service',
      70_000,
    );
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    await app?.close();
  });

  const hitRows = async (): Promise<number> => {
    const rows = await db.query<Array<{ n: string }>>('SELECT count(*) AS n FROM "throttler_hit"');
    return Number(rows[0]?.n);
  };

  async function connect(token: string): Promise<TelemetrySocket> {
    const url = (await app.getUrl()).replace('[::1]', 'localhost');
    const socket: TelemetrySocket = io(`${url}${TELEMETRY_NAMESPACE}`, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error) => reject(error));
    });
    return socket;
  }

  const watch = (socket: TelemetrySocket, assets: string[]) =>
    socket.timeout(5_000).emitWithAck(TelemetryEvents.Watch, { assets });

  it('counts an HTTP read in `throttler_hit` and a watch message in nothing', async () => {
    const token = await signToken({ sub: randomUUID() });

    // The control: the table does see a throttled HTTP request from this user.
    const beforeHttp = await hitRows();
    await request(app.getHttpServer())
      .get('/api/zones')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(await hitRows()).toBeGreaterThan(beforeHttp);

    const socket = await connect(token);
    const beforeWatch = await hitRows();
    for (let i = 0; i < 5; i++) {
      await expect(watch(socket, ['CT-01'])).resolves.toEqual({ accepted: ['CT-01'] });
    }

    expect(await hitRows()).toBe(beforeWatch);
  });

  it('answers a `viewer` too: the handshake was the role check', async () => {
    const socket = await connect(await signToken({ sub: randomUUID(), roles: ['viewer'] }));

    await expect(watch(socket, ['CT-01', 'CT-02'])).resolves.toEqual({
      accepted: ['CT-01', 'CT-02'],
    });
  });

  it('does not share one limit between sockets: each has its five a second', async () => {
    const first = await connect(await signToken({ sub: randomUUID() }));
    const second = await connect(await signToken({ sub: randomUUID() }));

    const firstAcks = await Promise.all(Array.from({ length: 6 }, () => watch(first, ['CT-01'])));
    const secondAck = await watch(second, ['CT-02']);

    expect(firstAcks.map((ack) => ack.accepted.length)).toEqual([1, 1, 1, 1, 1, 0]);
    expect(secondAck).toEqual({ accepted: ['CT-02'] });
  });
});
