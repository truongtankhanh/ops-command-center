import { connect, type MqttClient } from 'mqtt';
import catalogue from '../catalogue.json';
import { dueReadings, type SimAsset } from './schedule';

/**
 * The device simulator of the `telemetry` Compose profile (ADR-0019): one MQTT connection per
 * asset of `catalogue.json`, each with its own account and last will, publishing the same
 * waveforms the mock source generates. Demo only: the credentials are the stack's demo values
 * (ADR-0006) and the broker is plain TCP on the Compose network.
 */

const TICK_MS = Number(process.env.SIM_TICK_MS ?? 1000);
const RECONNECT_MS = 5000;
const SHUTDOWN_GRACE_MS = 3000;

function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, service: 'telemetry-sim', msg, ...extra }));
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    log('error', `${name} is required`);
    process.exit(1);
  }
  return value;
}

const url = required('MQTT_URL');
const password = required('MQTT_DEVICE_PASSWORD');
if (!Number.isFinite(TICK_MS) || TICK_MS < 100) {
  log('error', 'SIM_TICK_MS must be a number of at least 100');
  process.exit(1);
}

const { site } = catalogue;
const assets = catalogue.assets as SimAsset[];
const topic = (code: string, leaf: 'telemetry' | 'status') => `occ/${site}/asset/${code}/${leaf}`;
const online = JSON.stringify({ online: true });
const offline = JSON.stringify({ online: false });

const lastBoundary = new Map<string, number>();
const clients = new Map<string, MqttClient>();

for (const asset of assets) {
  const client = connect(url, {
    clientId: `occ-sim-${asset.code}`,
    username: asset.code,
    password,
    reconnectPeriod: RECONNECT_MS,
    // The broker announces a dead device by itself (ADR-0019): retained, so a late subscriber sees it.
    will: {
      topic: topic(asset.code, 'status'),
      payload: Buffer.from(offline),
      qos: 1,
      retain: true,
    },
  });
  client.on('connect', () => {
    client.publish(topic(asset.code, 'status'), online, { qos: 1, retain: true });
    log('info', 'connected', { asset: asset.code });
  });
  client.on('close', () => log('warn', 'disconnected', { asset: asset.code }));
  client.on('error', (error) =>
    log('error', 'connection error', { asset: asset.code, error: error.message }),
  );
  clients.set(asset.code, client);
}

const timer = setInterval(() => {
  const nowMs = Date.now();
  for (const asset of assets) {
    const client = clients.get(asset.code);
    // A device that is offline loses what it would have sent: latest wins, nothing is queued.
    if (!client?.connected) continue;
    for (const reading of dueReadings(asset, nowMs, lastBoundary)) {
      client.publish(
        topic(asset.code, 'telemetry'),
        JSON.stringify({ at: reading.at, values: reading.values }),
        { qos: 0 },
      );
    }
  }
}, TICK_MS);

log('info', 'started', { site, assets: assets.length, tickMs: TICK_MS });

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  log('info', 'stopping', { signal });
  // A clean disconnect does not fire the will, so say it ourselves, then close.
  const closing = [...clients].map(
    ([code, client]) =>
      new Promise<void>((resolve) => {
        if (!client.connected) return client.end(true, {}, () => resolve());
        client.publish(topic(code, 'status'), offline, { qos: 1, retain: true }, () =>
          client.end(false, {}, () => resolve()),
        );
      }),
  );
  await Promise.race([
    Promise.all(closing),
    new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
