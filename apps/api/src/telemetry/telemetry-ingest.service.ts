import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type {
  TelemetryAssetOverview,
  TelemetryAssetSnapshot,
  TelemetryValue,
} from '@occ/contracts';
import { AssetsService, type CatalogueAsset } from '../assets/assets.service';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';
import { ListenerSet } from './listener-set';
import { TELEMETRY_SOURCE } from './telemetry-source.provider';
import type { RawReading, TelemetrySource, Unsubscribe, UpstreamState } from './telemetry-source';
import {
  type CatalogueIndex,
  indexCatalogue,
  type ValidatedReading,
  validateReading,
} from './validate-reading';

// The catalogue changes by migration or reviewed write, never through the API (ADR-0018), so a slow
// re-read is enough. It also covers the first boot of a fresh database: Nest runs this module's
// bootstrap hook before the root module's `SeedService`, so the first read finds nothing. The mock
// source re-reads on the same period (`mock-telemetry-source.ts`), so the two never disagree for
// longer than one.
const CATALOGUE_REFRESH_MS = 60_000;

// "First seen as unknown" is bookkeeping keyed by what a device sent, so it is capped: past this
// many entries nothing more is remembered or logged (ADR-0019: a dropped reading is counted, never
// logged per message). The shown code is cut short for the same reason.
const MAX_SEEN_UNKNOWN = 256;
const MAX_LOGGED_CODE_LENGTH = 64;

/** The latest accepted reading of one key. */
interface KeyState {
  value: TelemetryValue;
  /** ISO time the device measured the value, or the receive time when it did not say. */
  at: string;
  /** ISO time this replica received it. */
  receivedAt: string;
  /** From the service's one counter: what `changedSince` compares a cursor against. */
  version: number;
}

interface AssetState {
  online: boolean;
  keys: Map<string, KeyState>;
  /** The newest `receivedAt` among `keys`. ISO strings of one format sort as text. */
  receivedAt: string;
}

/** The keys of one asset received since a cursor (`changedSince`). */
export interface TelemetryChange {
  assetCode: string;
  values: Record<string, TelemetryValue>;
  /** The newest `at` among these keys. */
  at: string;
  /** The newest `receivedAt` among these keys. */
  receivedAt: string;
}

/**
 * The bridge's core (ADR-0019): it starts the telemetry source, checks every reading against the
 * catalogue, drops and counts what does not fit, and keeps the latest state of every asset in
 * memory. State is per replica on purpose: replicas do not coordinate readings.
 *
 * It owns the source's life cycle, so it is the only party that registers on the port before
 * `start()`; the upstream state is reported once there and not replayed, which is why it holds it
 * (`upstream()`) for the gateway of V2-06.6 to read on connect.
 *
 * Readings are the hot path: `ingest` allocates little, queries nothing and logs nothing per
 * message. Reads hand out copies, never the live maps.
 */
@Injectable()
export class TelemetryIngestService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(TelemetryIngestService.name);
  private readonly upstreamListeners = new ListenerSet<UpstreamState>(this.logger);
  private readonly state = new Map<string, AssetState>();
  private readonly seenUnknown = new Set<string>();
  private readonly unsubscribers: Unsubscribe[] = [];

  private index: CatalogueIndex = new Map();
  private summary = '0 assets, 0 points';
  private version = 0;
  // A source that has not reported is not connected: `paused` is the truth, and it is never
  // `undefined` for a console that connects before the source says anything.
  private upstreamState: UpstreamState = { upstream: 'paused', since: new Date().toISOString() };
  private refreshTimer?: NodeJS.Timeout;
  private reloading = false;
  private stopped = false;
  private unknownLimitReported = false;

  constructor(
    @Inject(TELEMETRY_SOURCE) private readonly source: TelemetrySource,
    private readonly assets: AssetsService,
    private readonly metrics: TelemetryMetrics,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // The gauge reads the state held here, which is `paused` until the source says otherwise.
    this.metrics.trackUpstream(() => this.upstreamState.upstream === 'live');
    // Before `start()`: the upstream state is reported once there.
    this.unsubscribers.push(
      this.source.onReading((reading) => {
        this.ingest(reading);
      }),
      this.source.onUpstream((state) => this.setUpstream(state)),
      this.source.onStatus((report) => this.markOnline(report.assetCode, report.online)),
    );

    await this.reload();
    // `unref()`: this timer alone must not keep the process alive, in a spec or at shutdown.
    this.refreshTimer = setInterval(() => void this.reload(), CATALOGUE_REFRESH_MS);
    this.refreshTimer.unref();
    this.logger.log(`Telemetry ingest on: ${this.source.kind} source, ${this.summary}`);

    // Not awaited: a source whose `start()` is slow or never settles (a broker that is down) must
    // not delay listening or fail boot (ADR-0013, ADR-0019).
    void this.startSource();
  }

  /** Before TypeORM closes the pool, so a source holding a connection lets it go first. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    try {
      await this.source.stop();
    } catch (error) {
      this.logger.warn(`Telemetry source failed to stop: ${reasonOf(error)}`);
    }
  }

  /**
   * Checks one reading, counts it, and applies the values that passed. Returns those values.
   * Latest wins by arrival: a later reading replaces a key whatever its `at` says.
   */
  ingest(raw: RawReading): Record<string, TelemetryValue> {
    const nowMs = Date.now();
    const checked = validateReading(this.index, raw, nowMs);
    this.metrics.countMessage(checked.result);
    this.noteUnknown(raw.assetCode, checked);
    if (Object.keys(checked.values).length > 0) {
      this.store(raw.assetCode, checked, new Date(nowMs).toISOString());
    }
    return checked.values;
  }

  /**
   * A device's last will or return, from a source that carries presence (V2-06.5). An asset this
   * replica holds no reading of is left alone: it stays absent, never a placeholder, and its next
   * accepted reading says it is online anyway. The server never times a device out; freshness is
   * the console's call from `receivedAt` (ADR-0019).
   */
  markOnline(assetCode: string, online: boolean): void {
    const asset = this.state.get(assetCode);
    if (asset) asset.online = online;
  }

  /** Every asset with a reading, by code. An asset with no reading is absent. */
  latestState(): Record<string, TelemetryAssetSnapshot> {
    const snapshot: Record<string, TelemetryAssetSnapshot> = {};
    for (const [assetCode, asset] of this.state) snapshot[assetCode] = snapshotEntry(asset);
    return snapshot;
  }

  /**
   * As `latestState`, for the listed codes only; one that holds no reading is absent. A watch
   * (V2-06.7) is up to a handful of codes, so this does not build the whole state to pick from it.
   */
  snapshotOf(assetCodes: readonly string[]): Record<string, TelemetryAssetSnapshot> {
    const snapshot: Record<string, TelemetryAssetSnapshot> = {};
    for (const assetCode of assetCodes) {
      const asset = this.state.get(assetCode);
      if (asset) snapshot[assetCode] = snapshotEntry(asset);
    }
    return snapshot;
  }

  /**
   * Whether the catalogue this replica last read has this asset. In memory on purpose: it is asked
   * for every code of every `telemetry.watch`, which must not cost a query. Like everything here
   * it is empty until the first catalogue read, and a seeded database is seen within one refresh.
   */
  knows(assetCode: string): boolean {
    return this.index.has(assetCode);
  }

  /** As `latestState`, with only the headline points that have a value. */
  overview(): Record<string, TelemetryAssetOverview> {
    const overview: Record<string, TelemetryAssetOverview> = {};
    for (const [assetCode, asset] of this.state) {
      const headline: Record<string, TelemetryValue> = {};
      for (const key of this.index.get(assetCode)?.headlineKeys ?? []) {
        const entry = asset.keys.get(key);
        if (entry) headline[key] = entry.value;
      }
      overview[assetCode] = { online: asset.online, receivedAt: asset.receivedAt, headline };
    }
    return overview;
  }

  /** The latest value of every key of one asset; empty when this replica holds none. */
  valuesOf(assetCode: string): Record<string, TelemetryValue> {
    const values: Record<string, TelemetryValue> = {};
    for (const [key, entry] of this.state.get(assetCode)?.keys ?? []) values[key] = entry.value;
    return values;
  }

  /**
   * The keys received since a cursor, per asset, and the cursor to pass next time. Start from `0`.
   * Reading is not destructive, so the frame stream (V2-06.7) and the sample writer (V2-06.9) each
   * keep a cursor of their own. A key is listed whenever a reading of it arrived, whether or not
   * its value differs: deciding what "changed" means to a console is the caller's. It scans every
   * held key, which is a few hundred at the demo's size.
   */
  changedSince(version: number): { version: number; changes: TelemetryChange[] } {
    const changes: TelemetryChange[] = [];
    for (const [assetCode, asset] of this.state) {
      let change: TelemetryChange | undefined;
      for (const [key, entry] of asset.keys) {
        if (entry.version <= version) continue;
        change ??= { assetCode, values: {}, at: entry.at, receivedAt: entry.receivedAt };
        change.values[key] = entry.value;
        if (entry.at > change.at) change.at = entry.at;
        if (entry.receivedAt > change.receivedAt) change.receivedAt = entry.receivedAt;
      }
      if (change) changes.push(change);
    }
    return { version: this.version, changes };
  }

  /** The state of this replica's source connection, as `telemetry.status` sends it. */
  upstream(): UpstreamState {
    return { ...this.upstreamState };
  }

  /** Called on every change of `upstream()`, not on a repeat of the same state. */
  onUpstream(listener: (state: UpstreamState) => void): Unsubscribe {
    return this.upstreamListeners.add(listener);
  }

  private async startSource(): Promise<void> {
    try {
      await this.source.start();
    } catch (error) {
      this.logger.warn(`Telemetry source failed to start: ${reasonOf(error)}`);
    }
  }

  private setUpstream(next: UpstreamState): void {
    if (next.upstream === this.upstreamState.upstream) return;
    this.upstreamState = { ...next };
    if (next.upstream === 'paused') this.logger.warn('Telemetry upstream paused');
    else this.logger.log('Telemetry upstream live');
    this.upstreamListeners.notify({ ...next });
  }

  private store(assetCode: string, checked: ValidatedReading, receivedAt: string): void {
    let asset = this.state.get(assetCode);
    if (!asset) {
      asset = { online: true, keys: new Map(), receivedAt };
      this.state.set(assetCode, asset);
    }
    // A reading from a device is proof of life: only a status can say otherwise, and a later
    // reading takes that back.
    asset.online = true;
    if (receivedAt > asset.receivedAt) asset.receivedAt = receivedAt;
    for (const [key, value] of Object.entries(checked.values)) {
      asset.keys.set(key, { value, at: checked.at, receivedAt, version: ++this.version });
    }
  }

  /** A re-entrant or late read is dropped, and a failed one keeps the previous catalogue. */
  private async reload(): Promise<void> {
    if (this.reloading) return;
    this.reloading = true;
    try {
      const catalogue = await this.assets.catalogue();
      if (!this.stopped) this.replaceCatalogue(catalogue);
    } catch (error) {
      this.logger.warn(`Catalogue read failed, keeping the previous one: ${reasonOf(error)}`);
    } finally {
      this.reloading = false;
    }
  }

  private replaceCatalogue(catalogue: readonly CatalogueAsset[]): void {
    const points = catalogue.reduce((sum, asset) => sum + asset.points.length, 0);
    const summary = `${catalogue.length} assets, ${points} points`;
    this.index = indexCatalogue(catalogue);
    this.prune();
    if (summary !== this.summary) this.logger.debug(`Catalogue changed: ${summary}`);
    this.summary = summary;
  }

  /**
   * Drops what left the catalogue, so memory stays bounded by assets times keys. A value held for
   * a point whose range changed is kept: the next reading replaces it.
   */
  private prune(): void {
    for (const [assetCode, asset] of this.state) {
      const known = this.index.get(assetCode);
      if (!known) {
        this.state.delete(assetCode);
        continue;
      }
      let removed = false;
      for (const key of asset.keys.keys()) {
        if (!known.points.has(key)) {
          asset.keys.delete(key);
          removed = true;
        }
      }
      if (asset.keys.size === 0) this.state.delete(assetCode);
      else if (removed) asset.receivedAt = newestReceivedAt(asset.keys);
    }
  }

  /** `debug`, once per unknown asset or key, until the cap is reached. */
  private noteUnknown(assetCode: unknown, checked: ValidatedReading): void {
    if (checked.result !== 'unknown_asset' && checked.unknownKeys.length === 0) return;
    if (this.seenUnknown.size >= MAX_SEEN_UNKNOWN) {
      if (!this.unknownLimitReported) {
        this.unknownLimitReported = true;
        this.logger.debug('Further unknown assets and keys are not logged');
      }
      return;
    }
    const code = shown(assetCode);
    if (checked.result === 'unknown_asset') {
      this.noteOnce(`asset ${code}`, `Unknown asset in telemetry: ${code}`);
      return;
    }
    for (const key of checked.unknownKeys) {
      const id = `${code}/${shown(key)}`;
      this.noteOnce(`key ${id}`, `Unknown key in telemetry: ${id}`);
    }
  }

  private noteOnce(id: string, message: string): void {
    if (this.seenUnknown.size >= MAX_SEEN_UNKNOWN || this.seenUnknown.has(id)) return;
    this.seenUnknown.add(id);
    this.logger.debug(message);
  }
}

/** A copy: what callers get never aliases the live maps. */
function snapshotEntry(asset: AssetState): TelemetryAssetSnapshot {
  const values: Record<string, TelemetryValue> = {};
  for (const [key, entry] of asset.keys) values[key] = entry.value;
  return { online: asset.online, receivedAt: asset.receivedAt, values };
}

function newestReceivedAt(keys: ReadonlyMap<string, KeyState>): string {
  let newest = '';
  for (const entry of keys.values()) if (entry.receivedAt > newest) newest = entry.receivedAt;
  return newest;
}

/** A device-supplied code as it is stored and logged: text, and short. */
function shown(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value);
  return text.length > MAX_LOGGED_CODE_LENGTH ? `${text.slice(0, MAX_LOGGED_CODE_LENGTH)}…` : text;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
