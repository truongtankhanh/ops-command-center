import { Logger } from '@nestjs/common';
import { connect, type MqttClient } from 'mqtt';
import { ListenerSet } from './listener-set';
import { MAX_PAYLOAD_BYTES, parseTopic, SUBSCRIPTION_FILTER } from './mqtt-topic';
import type {
  AssetStatusReport,
  RawReading,
  TelemetrySource,
  Unsubscribe,
  UpstreamState,
} from './telemetry-source';

// A fixed period, not a growing one: this is one connection per replica on an internal network,
// and MQTT.js offers no backoff of its own. Longer than its 1 s default so a broker that is
// restarting is not hammered; short enough that a console's "Telemetry paused" does not linger.
const DEFAULT_RECONNECT_MS = 2_000;
// The site code and the subscription are re-checked on this period, the same as the catalogue's
// (ADR-0018: it changes by migration or reviewed write, never through the API).
const DEFAULT_SITE_REFRESH_MS = 60_000;

export interface MqttSourceOptions {
  url: string;
  username?: string;
  password?: string;
  /** The broker's CA certificate, read once by the caller. Unset: the system trust store. */
  ca?: Buffer;
  /** The code in `occ/{siteCode}/...`, or `null` while there is no site row yet (Q1). */
  loadSiteCode: () => Promise<string | null>;
  reconnectMs?: number;
  siteRefreshMs?: number;
}

/**
 * Production source (`TELEMETRY_SOURCE=mqtt`): subscribes to the devices' topics on the broker and
 * hands what arrives to the consumer as the port's readings and presence reports (ADR-0019). It
 * never publishes: no `publish()`, no last will of its own, and the one subscription is the only
 * thing it asks of the broker.
 *
 * - A broker that is down at boot, or goes away later, is not an error of this class: the client
 *   keeps reconnecting and the upstream state says `paused` until a subscription is accepted again.
 *   `start()` resolves without waiting for the connection.
 * - The upstream state is `live` only once the broker has accepted the subscription. A broker that
 *   takes the connection but refuses the subscription (an ACL) delivers nothing, and saying `live`
 *   there would tell every console all is well while every asset goes stale.
 * - A message it cannot read is not its to count: an unparseable payload for an asset goes on as
 *   a reading with no values, so the consumer counts it with everything else.
 *
 * The client id is left to MQTT.js (random per client) and the session is clean. Every replica
 * subscribes, and a fixed id would make the replicas disconnect each other in a loop.
 */
export class MqttTelemetrySource implements TelemetrySource {
  readonly kind = 'mqtt';

  private readonly logger = new Logger(MqttTelemetrySource.name);
  private readonly readings = new ListenerSet<RawReading>(this.logger);
  private readonly upstream = new ListenerSet<UpstreamState>(this.logger);
  private readonly statuses = new ListenerSet<AssetStatusReport>(this.logger);
  private readonly reconnectMs: number;
  private readonly siteRefreshMs: number;

  private client?: MqttClient;
  private siteCode: string | null = null;
  private running = false;
  /** Bumped by `stop()`, so an event or a read that outlives it knows it was cancelled. */
  private generation = 0;
  private lastUpstream?: UpstreamState['upstream'];
  private subscribed = false;
  /** One `warn` per outage, so a broker that is down does not log on every reconnect. */
  private outageLogged = false;
  private loadingSite = false;
  private siteTimer?: NodeJS.Timeout;

  constructor(private readonly options: MqttSourceOptions) {
    this.reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
    this.siteRefreshMs = options.siteRefreshMs ?? DEFAULT_SITE_REFRESH_MS;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;

    // Before connecting, so the first messages are not dropped for want of a site code.
    await this.refreshSiteCode();
    // `stop()` may have come while the read was in flight, and a `start()` after it.
    if (!this.running || generation !== this.generation) return;

    // The state at start is `paused`: not connected yet. The port reports it once here.
    this.setUpstream('paused');
    this.openConnection(generation);

    // `unref()`: this timer alone must not keep the process alive, in a spec or at shutdown.
    this.siteTimer = setInterval(() => void this.refresh(generation), this.siteRefreshMs);
    this.siteTimer.unref();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.generation++;
    clearInterval(this.siteTimer);
    this.siteTimer = undefined;

    const client = this.client;
    this.client = undefined;
    this.subscribed = false;
    this.lastUpstream = undefined;
    this.outageLogged = false;
    // Forced, so a dead broker cannot hold shutdown, which runs before the database pool closes.
    // The client's listeners stay: each one checks the generation, and an `'error'` must always
    // have a listener.
    client?.end(true);
    this.logger.log('MQTT telemetry source off');
  }

  onReading(listener: (reading: RawReading) => void): Unsubscribe {
    return this.readings.add(listener);
  }

  onUpstream(listener: (state: UpstreamState) => void): Unsubscribe {
    return this.upstream.add(listener);
  }

  onStatus(listener: (report: AssetStatusReport) => void): Unsubscribe {
    return this.statuses.add(listener);
  }

  private openConnection(generation: number): void {
    // `connect()`, not `connectAsync()`: the latter rejects on the first `'error'`, which for a
    // broker that is down at boot would leave no client to keep trying.
    const client = connect(this.options.url, {
      username: this.options.username,
      password: this.options.password,
      ca: this.options.ca,
      reconnectPeriod: this.reconnectMs,
      // A refused CONNACK (broker not ready, credentials not yet rotated) is retried too: without
      // this the replica would stay `paused` until restarted.
      reconnectOnConnackError: true,
      clean: true,
      // A clean session keeps nothing, so every connection subscribes again itself.
      resubscribe: false,
    });
    this.client = client;
    this.logger.log(`MQTT telemetry source on: ${describeBroker(this.options.url)}`);

    client.on('connect', () => {
      if (!this.isCurrent(client, generation)) return;
      this.outageLogged = false;
      this.subscribe(client, generation);
    });
    client.on('message', (topic, payload) => {
      if (this.isCurrent(client, generation)) this.handleMessage(topic, payload);
    });
    // `close` follows every lost or failed connection; `offline` and `end` are the same fact.
    for (const event of ['close', 'offline', 'end'] as const) {
      client.on(event, () => {
        if (!this.isCurrent(client, generation)) return;
        this.subscribed = false;
        this.setUpstream('paused');
      });
    }
    client.on('error', (error) => {
      if (!this.isCurrent(client, generation)) return;
      this.warnOnce(`MQTT connection failed: ${error.message}`);
      this.setUpstream('paused');
    });
  }

  private subscribe(client: MqttClient, generation: number): void {
    client.subscribe(SUBSCRIPTION_FILTER, { qos: 1 }, (error, granted) => {
      if (!this.isCurrent(client, generation)) return;
      const refused = granted?.some((grant) => grant.qos === 128) ?? false;
      if (error || refused) {
        this.subscribed = false;
        this.warnOnce(`MQTT subscription refused: ${error?.message ?? 'not granted'}`);
        return;
      }
      this.subscribed = true;
      this.setUpstream('live');
    });
  }

  /** The timed re-read of the site code, and one more try at a subscription the broker refused. */
  private async refresh(generation: number): Promise<void> {
    await this.refreshSiteCode();
    const client = this.client;
    if (!client || !this.isCurrent(client, generation)) return;
    if (client.connected && !this.subscribed) this.subscribe(client, generation);
  }

  /** A failed or empty read keeps the previous code: never fails boot, never blanks the filter. */
  private async refreshSiteCode(): Promise<void> {
    if (this.loadingSite) return;
    this.loadingSite = true;
    try {
      const code = await this.options.loadSiteCode();
      if (code !== null && code !== this.siteCode) {
        this.siteCode = code;
        this.logger.log(`MQTT telemetry site code: ${code}`);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Site code read failed, keeping the previous one: ${reason}`);
    } finally {
      this.loadingSite = false;
    }
  }

  /**
   * One message. Synchronous and quiet: it runs per device reading (ADR-0019 forbids a log line per
   * message), and nothing it does may throw into the client's event loop.
   */
  private handleMessage(topic: string, payload: Buffer): void {
    const parsed = parseTopic(topic);
    if (!parsed || this.siteCode === null || parsed.siteCode !== this.siteCode) return;

    if (parsed.kind === 'telemetry') {
      this.readings.notify(toReading(parsed.assetCode, payload));
      return;
    }
    const report = toStatusReport(parsed.assetCode, payload);
    if (report) this.statuses.notify(report);
  }

  /** Reports a change only: MQTT.js fires `close`, `offline` and `error` repeatedly in one outage. */
  private setUpstream(next: UpstreamState['upstream']): void {
    if (this.lastUpstream === next) return;
    this.lastUpstream = next;
    this.upstream.notify({ upstream: next, since: new Date().toISOString() });
  }

  private warnOnce(message: string): void {
    if (this.outageLogged) return;
    this.outageLogged = true;
    this.logger.warn(message);
  }

  private isCurrent(client: MqttClient, generation: number): boolean {
    return this.running && generation === this.generation && this.client === client;
  }
}

/**
 * A telemetry payload as the port's reading. Too large, not JSON, or not an object is a reading
 * with no values, which the consumer counts as `invalid`. A parsed object is passed through
 * untouched: the wire is not trusted to match the port's types, and `validateReading` is where
 * `at` and `values` are checked (and where keys are looked up in a `Map`, since `__proto__` is a
 * valid JSON key).
 */
function toReading(assetCode: string, payload: Buffer): RawReading {
  const body = payload.length > MAX_PAYLOAD_BYTES ? undefined : parseJson(payload);
  if (!isPlainObject(body)) return { assetCode, values: {} };
  return {
    assetCode,
    at: body.at as RawReading['at'],
    values: body.values as RawReading['values'],
  };
}

/** `{ online: boolean }`, or `undefined` for anything else: a malformed status is ignored. */
function toStatusReport(assetCode: string, payload: Buffer): AssetStatusReport | undefined {
  if (payload.length > MAX_PAYLOAD_BYTES) return undefined;
  const body = parseJson(payload);
  if (!isPlainObject(body) || typeof body.online !== 'boolean') return undefined;
  return { assetCode, online: body.online };
}

function parseJson(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Scheme and host only: whatever else the URL carries may be a credential. */
function describeBroker(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return 'broker';
  }
}
