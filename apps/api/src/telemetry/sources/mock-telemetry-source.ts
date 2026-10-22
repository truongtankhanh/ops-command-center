import { Logger } from '@nestjs/common';
import type { TelemetryValue } from '@occ/contracts';
import type { CatalogueAsset } from '../../assets/assets.service';
import { ListenerSet } from './listener-set';
import { type DemoScenarioEntry, scenarioSummary, scenarioValueAt } from './mock-scenario';
import { valueAt } from './mock-waveform';
import type {
  AssetStatusReport,
  RawReading,
  TelemetrySource,
  Unsubscribe,
  UpstreamState,
} from './telemetry-source';

const DEFAULT_TICK_MS = 1_000;
// The catalogue changes by migration or reviewed write, never through the API (ADR-0018), so a
// slow re-read is enough. It also covers the first boot of a fresh database, where the seed runs
// after this module has started.
const DEFAULT_REFRESH_MS = 60_000;

export interface MockTelemetryOptions {
  tickMs?: number;
  refreshMs?: number;
  /** Epoch milliseconds. Injectable so a spec can drive time without patching globals. */
  now?: () => number;
  /**
   * Breaches to script over the waveform (`DEMO_SCENARIO` in the demo). Absent or empty: the
   * source is "normal operation" and raises nothing. Injectable so a suite can use a short cycle.
   */
  scenario?: readonly DemoScenarioEntry[];
}

/**
 * Demo and development source (`TELEMETRY_SOURCE=mock`): generates the readings of every asset of
 * the catalogue in process, so `docker compose up` shows a live twin with no broker (ADR-0019).
 *
 * Every value is a pure function of asset, key and time (`valueAt`), and a reading's `at` is the
 * boundary of the point's interval, not the wall clock. Two replicas therefore emit the same
 * `(at, values)` without talking to each other, whatever their timers' offsets.
 *
 * The waveform is "normal operation": it never breaches a rule. A breach is a scripted event, the
 * `scenario` option, which overrides one asset's value for a window of each cycle and is a pure
 * function of time too (`mock-scenario.ts`).
 */
export class MockTelemetrySource implements TelemetrySource {
  readonly kind = 'mock';

  private readonly logger = new Logger(MockTelemetrySource.name);
  private readonly readings = new ListenerSet<RawReading>(this.logger);
  private readonly upstream = new ListenerSet<UpstreamState>(this.logger);
  private readonly tickMs: number;
  private readonly refreshMs: number;
  private readonly now: () => number;
  private readonly scenario: readonly DemoScenarioEntry[];

  private catalogue: readonly CatalogueAsset[] = [];
  /** The last boundary emitted per `asset/key`: bounded by assets times points. */
  private readonly lastBoundary = new Map<string, number>();
  private running = false;
  /** Bumped by `stop()`, so a `start()` still reading the catalogue knows it was cancelled. */
  private generation = 0;
  private reloading = false;
  private tickTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private readonly loadCatalogue: () => Promise<readonly CatalogueAsset[]>,
    options: MockTelemetryOptions = {},
  ) {
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
    this.now = options.now ?? (() => Date.now());
    this.scenario = options.scenario ?? [];
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    await this.reload();
    // `stop()` may have come while the first read was in flight, and a `start()` after it.
    if (!this.running || generation !== this.generation) return;

    this.lastBoundary.clear();
    this.upstream.notify({ upstream: 'live', since: new Date(this.now()).toISOString() });
    this.logger.log(`Mock telemetry source on: ${this.summary()}, a tick every ${this.tickMs} ms`);
    // Once, so a demo's alarm is never a surprise in the log (ADR-0014).
    if (this.scenario.length > 0) {
      this.logger.log(`Demo scenario on: ${scenarioSummary(this.scenario)}`);
    }
    this.emitDue();

    // `unref()`: the generator alone must not keep the process alive, in a spec or at shutdown.
    this.tickTimer = setInterval(() => this.emitDue(), this.tickMs);
    this.tickTimer.unref();
    this.refreshTimer = setInterval(() => void this.refresh(), this.refreshMs);
    this.refreshTimer.unref();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.generation++;
    clearInterval(this.tickTimer);
    clearInterval(this.refreshTimer);
    this.tickTimer = undefined;
    this.refreshTimer = undefined;
    this.logger.log('Mock telemetry source off');
  }

  onReading(listener: (reading: RawReading) => void): Unsubscribe {
    return this.readings.add(listener);
  }

  onUpstream(listener: (state: UpstreamState) => void): Unsubscribe {
    return this.upstream.add(listener);
  }

  /** Never called back: a generated device never goes away, so it has no presence to report. */
  onStatus(_listener: (report: AssetStatusReport) => void): Unsubscribe {
    return () => undefined;
  }

  private summary(): string {
    const points = this.catalogue.reduce((sum, asset) => sum + asset.points.length, 0);
    return `${this.catalogue.length} assets, ${points} points`;
  }

  /** The timed re-read: says so, once per change, when the catalogue is not what it was. */
  private async refresh(): Promise<void> {
    const before = this.summary();
    await this.reload();
    const after = this.summary();
    if (after !== before) this.logger.debug(`Catalogue changed: ${after}`);
  }

  /** A failed read keeps the previous catalogue (empty on the first read): never fails boot. */
  private async reload(): Promise<void> {
    if (this.reloading) return;
    this.reloading = true;
    try {
      this.catalogue = await this.loadCatalogue();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Catalogue read failed, keeping the previous one: ${reason}`);
    } finally {
      this.reloading = false;
    }
  }

  /**
   * Emits, per asset, the points whose interval boundary has passed since they were last emitted.
   * A tick that finds several boundaries behind emits the latest only: latest wins. Points due at
   * the same boundary leave in one reading.
   */
  private emitDue(): void {
    const nowMs = this.now();
    for (const asset of this.catalogue) {
      if (!this.running) return;
      const byBoundary = new Map<number, Record<string, TelemetryValue>>();

      for (const point of asset.points) {
        const intervalMs = point.expectedIntervalS * 1000;
        const boundary = Math.floor(nowMs / intervalMs) * intervalMs;
        const id = `${asset.code}/${point.key}`;
        const last = this.lastBoundary.get(id);
        if (last !== undefined && boundary <= last) continue;

        this.lastBoundary.set(id, boundary);
        // A scripted breach replaces the healthy value by time only, so replicas still agree.
        const value =
          scenarioValueAt(this.scenario, asset.code, point, asset.rules, boundary) ??
          valueAt(asset.code, point, asset.rules, boundary);
        if (value === undefined) continue;
        const values = byBoundary.get(boundary) ?? {};
        values[point.key] = value;
        byBoundary.set(boundary, values);
      }

      for (const [boundary, values] of byBoundary) {
        this.readings.notify({
          assetCode: asset.code,
          at: new Date(boundary).toISOString(),
          values,
        });
      }
    }
  }
}
