import fs from 'node:fs';
import { type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Registry } from '@prometheus-io/client';
import { connectAsync, type MqttClient } from 'mqtt';
import request from 'supertest';
import { validateEnv } from '../src/config/env.validation';
import type { AppModule as AppModuleClass } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { SITE } from '../src/database/seed/campus';
import { TelemetryIngestService } from '../src/telemetry/ingest/telemetry-ingest.service';
import { startBroker, type TestBroker } from './support/mqtt-broker';

const API = { username: 'occ-api', password: 'e2e-broker-password-not-a-secret' };
// A cooling tower of the seed (class `cooling_tower`, which has a boolean `running` point).
const ASSET = 'CT-01';

const telemetryTopic = (assetCode: string, site: string = SITE.code) =>
  `occ/${site}/asset/${assetCode}/telemetry`;
const statusTopic = (assetCode: string, site: string = SITE.code) =>
  `occ/${site}/asset/${assetCode}/status`;
const reading = (values: Record<string, unknown>) => JSON.stringify({ at: new Date(), values });

/**
 * The MQTT source against a real broker in the test process (ADR-0019), through the whole app: the
 * topics, the validation counted by `telemetry_messages_total`, a device's last will, and the
 * source's own connection going away and coming back. The API's account is checked by the broker,
 * so the username and password really travel.
 *
 * `AppModule` validates the environment when it is imported, and the broker's port is only known
 * once it listens. So the environment is set first and the module is imported afterwards, and the
 * app is booted twice: the first boot migrates and seeds, so the second finds the catalogue and the
 * site row when its ingest service and its source read them at start. Cases run in order and the
 * broker outage is the last, because it leaves the app reconnecting.
 */
describe('MQTT telemetry source (e2e)', () => {
  let broker: TestBroker;
  let app: INestApplication;
  let ingest: TelemetryIngestService;
  let registry: Registry;
  let device: MqttClient;
  let stdoutWrites: jest.SpyInstance;
  let fileWrites: jest.SpyInstance;

  beforeAll(async () => {
    // Before the app is built, so its first lines are captured.
    stdoutWrites = jest.spyOn(process.stdout, 'write');
    fileWrites = jest.spyOn(fs, 'writeSync');

    broker = await startBroker(API);
    process.env.TELEMETRY_SOURCE = 'mqtt';
    process.env.MQTT_URL = broker.url;
    process.env.MQTT_USERNAME = API.username;
    process.env.MQTT_PASSWORD = API.password;
    process.env.LOG_LEVEL = 'debug';

    // Loaded here, not at the top: loading it loads `.env.test` into `process.env`
    // (`ConfigModule.forRoot`) and validates the environment, which must already name the broker.
    // So the database name is only known after it; nothing has touched the database yet. A
    // `require`, because under `module: nodenext` an `import()` needs a file extension and Jest
    // has no `.js` to find; the static `import type` above is erased and loads nothing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../src/app.module') as { AppModule: typeof AppModuleClass };
    assertTestDatabase(validateEnv(process.env).DB_NAME);

    await (await startApp(AppModule)).close();
    app = await startApp(AppModule);
    ingest = app.get(TelemetryIngestService);
    registry = app.get(Registry);

    // The same account as the API's: the broker has one, and the ACL is V2-06.11's.
    device = await connectAsync(broker.url, { ...API, clientId: 'e2e-device' });
    await eventually(
      () => ingest.upstream().upstream,
      (state) => state === 'live',
      'upstream live',
    );
  });

  afterAll(async () => {
    await app?.close();
    device?.end(true);
    await broker?.stop();
    jest.restoreAllMocks();
  });

  it('hands a reading published to a valid topic to the ingest service', async () => {
    const before = await counts();

    await publish(telemetryTopic(ASSET), reading({ running: true }));

    await eventually(counts, (c) => c.accepted === before.accepted + 1, 'an accepted reading');
    expect(ingest.valuesOf(ASSET)).toEqual({ running: true });
    expect(ingest.latestState()[ASSET].online).toBe(true);
  });

  it('counts a reading for an unknown asset `unknown_asset`, and holds nothing of it', async () => {
    const before = await counts();

    await publish(telemetryTopic('ZZ-99'), reading({ running: true }));

    await eventually(counts, (c) => c.unknown_asset === before.unknown_asset + 1, 'unknown_asset');
    expect(ingest.latestState()['ZZ-99']).toBeUndefined();
  });

  it('counts a payload over 4 KB, and one that is not JSON, `invalid`', async () => {
    const before = await counts();
    const oversized = JSON.stringify({ values: { running: false }, padding: 'x'.repeat(5000) });

    await publish(telemetryTopic(ASSET), oversized);
    await publish(telemetryTopic(ASSET), '{ not json');

    const after = await eventually(counts, (c) => c.invalid === before.invalid + 2, 'two invalid');
    expect(after.accepted).toBe(before.accepted);
    // Neither carried a value that was applied.
    expect(ingest.valuesOf(ASSET)).toEqual({ running: true });
  });

  it('ignores another site, another sub-topic and a malformed status, uncounted', async () => {
    const before = await counts();

    await publish(telemetryTopic(ASSET, 'OTHER-SITE'), reading({ running: false }));
    await publish(`occ/${SITE.code}/asset/${ASSET}/cmd`, JSON.stringify({ restart: true }));
    await publish(statusTopic(ASSET), JSON.stringify({ online: 'no' }));
    await publish(statusTopic(ASSET), 'offline');
    // Delivery on one connection is in order, so once this one is counted, so were the four above.
    await publish(telemetryTopic('ZZ-SENTINEL'), reading({ running: true }));

    const after = await eventually(
      counts,
      (c) => c.unknown_asset === before.unknown_asset + 1,
      'the sentinel',
    );
    expect(after).toEqual({ ...before, unknown_asset: before.unknown_asset + 1 });
    expect(ingest.valuesOf(ASSET)).toEqual({ running: true });
    expect(ingest.latestState()[ASSET].online).toBe(true);
  });

  it('marks an asset offline on a last will, and online again on its next reading', async () => {
    const will = await connectAsync(broker.url, {
      ...API,
      clientId: 'e2e-device-with-will',
      reconnectPeriod: 0,
      will: {
        topic: statusTopic(ASSET),
        payload: Buffer.from(JSON.stringify({ online: false })),
        qos: 1,
        retain: true,
      },
    });

    // Closing the socket without a DISCONNECT is what makes the broker publish the will.
    will.stream.destroy();
    will.end(true);

    await eventually(
      () => ingest.latestState()[ASSET].online,
      (online) => !online,
      'offline',
    );
    expect(ingest.valuesOf(ASSET)).toEqual({ running: true });

    await publish(telemetryTopic(ASSET), reading({ running: true }));
    await eventually(
      () => ingest.latestState()[ASSET].online,
      (online) => online,
      'online again',
    );
  });

  it('pauses when the broker goes away, stays ready, and resumes when it is back', async () => {
    await broker.stop();

    await eventually(
      () => ingest.upstream().upstream,
      (state) => state === 'paused',
      'paused',
    );
    // A broker outage is not a readiness failure (ADR-0013, ADR-0019).
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);

    await broker.start();

    // No restart of the API: the source reconnects and subscribes again by itself.
    await eventually(
      () => ingest.upstream().upstream,
      (state) => state === 'live',
      'live',
      20_000,
    );
    await eventually(
      () => device.connected,
      (connected) => connected,
      'the device back',
      20_000,
    );
    await publish(telemetryTopic(ASSET), reading({ running: false }));
    await eventually(
      () => ingest.valuesOf(ASSET).running,
      (running) => running === false,
      'a reading after the outage',
    );
  }, 60_000);

  it('never writes the broker password to the log, and does log the source', () => {
    const written = [
      ...stdoutWrites.mock.calls.map((call) => String(call[0])),
      ...fileWrites.mock.calls.map((call) => String(call[1])),
    ].join('');

    // Proves the capture saw the app's log at all, so the absence below means something.
    expect(written).toContain('MQTT telemetry source on');
    expect(written).toContain('Telemetry upstream paused');
    expect(written).not.toContain(API.password);
  });

  /** QoS 0, as a device's telemetry is. */
  async function publish(topic: string, payload: string): Promise<void> {
    await device.publishAsync(topic, payload, { qos: 0 });
  }

  /** The count of each result of `telemetry_messages_total`, by name. */
  async function counts(): Promise<Record<string, number>> {
    const { values } = await registry.getSingleMetric('telemetry_messages_total')!.get();
    return Object.fromEntries(values.map((value) => [String(value.labels.result), value.value]));
  }
});

async function startApp(AppModule: Type<unknown>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const nest = configureApp(moduleRef.createNestApplication());
  await nest.listen(0);
  return nest;
}

/** Polls `read` until `accept` likes it, or fails with the last value seen. */
async function eventually<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}; last value: ${JSON.stringify(value)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Like the other suites: never write to a database whose name does not end in `_test`. */
function assertTestDatabase(name: string): void {
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run against database "${name}": e2e needs a *_test database.`);
  }
}
