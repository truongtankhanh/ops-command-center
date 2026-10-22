import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetsService, type CatalogueAsset } from '../../assets/assets.service';
import type { Env } from '../../config/env.validation';
import { IncidentsService } from '../../incidents/incidents.service';
import { runJob } from '../../logging/request-context';
import { type TelemetryIncidentOutcome, TelemetryMetrics } from '../../metrics/telemetry.metrics';
import { formatRuleEvidence, type RuleEvidence } from './rule-evidence';
import { type EvaluableRule, selectEvaluableRules } from './rule-selection';
import { ARMED, evaluateRule, type RuleInput, type RuleState } from './rule-state';
import { type TelemetryChange, TelemetryIngestService } from '../ingest/telemetry-ingest.service';
import { TelemetryLeader } from '../ingest/telemetry-leader.service';

/**
 * How often the leader looks at what arrived: an alarm is decided at most this much after the
 * reading that completes its dwell. A constant, not a variable, as `LEADER_CHECK_MS` and
 * `SAMPLE_FLUSH_MS`. It stays well under the shortest `for_s` of the seed (10 s).
 */
export const RULE_EVALUATION_MS = 1_000;

// The catalogue changes by migration or reviewed write, never through the API (ADR-0018), so a slow
// re-read is enough. The ingest service and the mock source re-read on the same period
// (`CATALOGUE_REFRESH_MS` in each, private to it), so the three never disagree for longer than one.
export const RULE_CATALOGUE_REFRESH_MS = 60_000;

/** A rule of one asset, with the values its machine's state was earned under. */
interface Watched {
  rule: EvaluableRule;
  signature: string;
}

/** The rules of one asset by the key they watch, which is how a reading finds them. */
type AssetRules = Map<string, Watched[]>;

interface Machine {
  state: RuleState;
  signature: string;
}

/** What the evaluator reports once per change instead of once per attempt. */
type FailureKind = 'catalogue' | 'incidents' | 'run';

/**
 * Decides, on the telemetry leader only, when a rule's breach has lasted long enough and asks for
 * the incident (ADR-0018, ADR-0019). The decision is `rules/` (pure, V2-07.3); this class feeds it
 * and carries out what it answers.
 *
 * - **Fed by polling**, as `TelemetrySampleWriter`: it reads `changedSince` with a cursor of its
 *   own, so ingest knows nothing of it and is not slowed by it. What it can miss is a value that
 *   came and went between two ticks, which no dwell of 10 s or more can depend on.
 * - **One machine per asset and rule**, keyed by their ids. An override has a rule id of its own,
 *   so it never shares a machine with the class rule it replaces.
 * - **State is committed after acting.** A raise is asked of `IncidentsService`; `raised` and
 *   `already_open` both leave the machine `raised`, and a failure leaves it where it was, so the
 *   next breaching reading asks again. It never raises on a reading it has not seen.
 * - **Starts `armed` on gaining the lead** and drops every machine on losing it: after a failover
 *   an alarm can be late by up to `for_s` once, and the unique index makes a repeat harmless
 *   (ADR-0018). State is not persisted.
 * - **Nothing here is on the reading path**: no query per reading, and a slow or failing database
 *   delays the next tick, never a reading.
 */
@Injectable()
export class RuleEvaluator implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(RuleEvaluator.name);
  private readonly failing = new Set<FailureKind>();
  private readonly machines = new Map<string, Machine>();
  private catalogue = new Map<string, AssetRules>();
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private cursor = 0;
  private wasLeading = false;
  /** Bumped whenever the machines are dropped: an answer that arrives after it is a no-op. */
  private generation = 0;
  /** A read has succeeded at least once, so there is a catalogue to evaluate against. */
  private loaded = false;
  private lastReadAt = 0;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly ingest: TelemetryIngestService,
    private readonly leader: TelemetryLeader,
    private readonly assets: AssetsService,
    private readonly incidents: IncidentsService,
    private readonly metrics: TelemetryMetrics,
  ) {}

  onApplicationBootstrap(): void {
    // A replica with no source never leads, so a timer would only wake to return.
    if (this.config.getOrThrow('TELEMETRY_SOURCE', { infer: true }) === 'off') return;
    // Each tick is a run of its own (ADR-0014), as the writer's flushes are.
    this.timer = setInterval(() => void runJob(() => this.evaluate()), RULE_EVALUATION_MS);
    // `unref()`: this timer alone must not keep the process alive, in a spec or at shutdown.
    this.timer.unref();
  }

  /** Before TypeORM closes the pool, so a write in flight finishes first. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** One tick. Public so it can be driven directly in tests. Never rejects; overlaps share one. */
  evaluate(now: Date = new Date()): Promise<void> {
    this.running ??= this.run(now).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /**
   * Feeds one batch of changes to the machines and carries out the raises, one write at a time and
   * in order. Public so a spec can give it changes with the times it chooses. Never rejects.
   */
  async apply(changes: readonly TelemetryChange[]): Promise<void> {
    const generation = this.generation;
    for (const change of changes) {
      const rulesByKey = this.catalogue.get(change.assetId);
      if (!rulesByKey) continue;
      // The time the replica received it (V2-07.3, Q2): the device's `at` can be replaced on clock
      // skew or go backwards. Per asset, not per key, which is within one tick of the truth.
      const at = Date.parse(change.receivedAt);
      for (const [key, value] of Object.entries(change.values)) {
        for (const watched of rulesByKey.get(key) ?? []) {
          if (!(await this.step(change.assetId, watched, { at, value }, generation))) return;
        }
      }
    }
  }

  private async run(now: Date): Promise<void> {
    try {
      if (!this.leader.isLeading()) {
        this.stepDown();
        return;
      }
      if (!this.wasLeading) {
        this.dropMachines();
        await this.refresh(now);
        // What arrived before the lead is not judged: it starts from the next reading.
        this.cursor = this.ingest.changedSince(Number.MAX_SAFE_INTEGER).version;
        this.wasLeading = true;
        return;
      }
      // Without a copy a leader is blind: retry every tick until the first read succeeds, then slowly.
      if (!this.loaded || now.getTime() - this.lastReadAt >= RULE_CATALOGUE_REFRESH_MS) {
        await this.refresh(now);
      }
      // Taken before the writes, so a reading that arrives during them is seen by the next tick.
      const { version, changes } = this.ingest.changedSince(this.cursor);
      await this.apply(changes);
      this.cursor = version;
      this.recovered('run', 'Telemetry rule evaluation recovered');
    } catch (error) {
      this.failed('run', 'Telemetry rule evaluation failed, will retry', error);
    }
  }

  /** One reading against one rule. `false` when the lead is gone and the batch must stop. */
  private async step(
    assetId: string,
    watched: Watched,
    input: RuleInput,
    generation: number,
  ): Promise<boolean> {
    const id = `${assetId}:${watched.rule.id}`;
    const held = this.machines.get(id);
    // A rule whose values changed in a refresh starts over: its state was earned under others.
    const before = held && held.signature === watched.signature ? held.state : ARMED;
    const { state, action } = evaluateRule(before, input, watched.rule);

    if (action.kind === 'none') {
      this.machines.set(id, { state, signature: watched.signature });
      return true;
    }

    // The leader is asked again here: the write is the one thing that cannot be taken back.
    if (!this.leader.isLeading()) {
      this.stepDown();
      return false;
    }
    const outcome = await this.raise(assetId, watched.rule, action.evidence);
    // The machines were dropped while the write was in flight: this answer belongs to a lead
    // that is over, and must not write a state into the next one.
    if (generation !== this.generation) return false;
    this.machines.set(id, {
      state: outcome === 'error' ? before : state,
      signature: watched.signature,
    });
    return true;
  }

  private async raise(
    assetId: string,
    rule: EvaluableRule,
    evidence: RuleEvidence,
  ): Promise<TelemetryIncidentOutcome> {
    try {
      // Type, severity, title, zone and position are the catalogue's, read by the service.
      const result = await this.incidents.reportFromTelemetry({
        assetId,
        telemetryRuleId: rule.id,
        note: formatRuleEvidence(evidence),
      });
      this.metrics.countIncident(result.outcome);
      this.recovered('incidents', 'Telemetry incident writes recovered');
      if (result.outcome === 'raised') {
        this.logger.log(`Rule ${rule.id} raised ${result.incident.code}`);
      } else {
        this.logger.debug(`Rule ${rule.id} already has an open incident`);
      }
      return result.outcome;
    } catch (error) {
      this.metrics.countIncident('error');
      this.failed('incidents', 'Telemetry incident write failed, will retry', error);
      return 'error';
    }
  }

  /** A failed read keeps the previous copy; a successful one prunes what left the catalogue. */
  private async refresh(now: Date): Promise<void> {
    this.lastReadAt = now.getTime();
    try {
      this.replaceCatalogue(await this.assets.catalogue());
      this.loaded = true;
      this.recovered('catalogue', 'Rule catalogue read recovered');
    } catch (error) {
      this.failed('catalogue', 'Rule catalogue read failed, keeping the previous one', error);
    }
  }

  private replaceCatalogue(assets: readonly CatalogueAsset[]): void {
    const next = new Map<string, AssetRules>();
    const present = new Set<string>();
    for (const asset of assets) {
      const byKey: AssetRules = new Map();
      for (const [key, rules] of selectEvaluableRules(asset)) {
        byKey.set(
          key,
          rules.map((rule) => {
            present.add(`${asset.id}:${rule.id}`);
            return { rule, signature: signatureOf(rule) };
          }),
        );
      }
      if (byKey.size > 0) next.set(asset.id, byKey);
    }
    this.catalogue = next;
    for (const id of this.machines.keys()) {
      if (!present.has(id)) this.machines.delete(id);
    }
  }

  private stepDown(): void {
    if (!this.wasLeading) return;
    this.wasLeading = false;
    this.dropMachines();
  }

  private dropMachines(): void {
    this.generation += 1;
    this.machines.clear();
  }

  /** Once per change: an outage is one line, not one per tick. */
  private failed(kind: FailureKind, what: string, error: unknown): void {
    if (this.failing.has(kind)) return;
    this.failing.add(kind);
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(`${what}: ${reason}`);
  }

  private recovered(kind: FailureKind, message: string): void {
    if (this.failing.delete(kind)) this.logger.log(message);
  }
}

/** The values a machine's state depends on, so a changed rule is told apart from an unchanged one. */
function signatureOf(rule: EvaluableRule): string {
  const { key, comparator, limit, clear, forS, expectedIntervalS } = rule;
  return `${key}|${comparator}|${limit}|${clear}|${forS}|${expectedIntervalS}`;
}
