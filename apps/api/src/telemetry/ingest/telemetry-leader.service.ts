import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Env } from '../config/env.validation';
import { AdvisoryLockLeader } from '../database/advisory-lock-leader';
import { runJob } from '../logging/request-context';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';

/**
 * How often a replica checks the lead: it takes it within one interval of the leader's process
 * dying, so this is the failover gap ADR-0019 budgets ("one leader-check interval plus `for_s`").
 * A constant, not a variable: it is not demo pacing and nobody should tune it per site.
 */
export const LEADER_CHECK_MS = 5_000;

/**
 * Elects one telemetry leader across all API replicas (ADR-0019, as `SimulatorLeader` for the
 * simulator, ADR-0008). Only the leader writes samples, manages their partitions and evaluates
 * threshold rules; every replica, the leader included, serves its own consoles. This class decides
 * who leads and nothing else: what the leader does with the lead is the writer's and the
 * evaluator's (V2-06.9, V2-07.4), which read `isLeading()`.
 *
 * Unlike the simulator, which checks on each of its ticks, it runs its own timer. A replica with
 * `TELEMETRY_SOURCE=off` has no readings to write or evaluate, so it starts no timer and never
 * opens the leader's connection; the gauge then reports 0.
 */
@Injectable()
export class TelemetryLeader implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly lock: AdvisoryLockLeader;
  private timer?: NodeJS.Timeout;

  constructor(
    dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
    private readonly metrics: TelemetryMetrics,
  ) {
    this.lock = new AdvisoryLockLeader(dataSource, {
      lock: 'Telemetry',
      label: 'Telemetry',
      logger: new Logger(TelemetryLeader.name),
    });
  }

  onApplicationBootstrap(): void {
    // Before the gate, so the series exists (at 0) on a replica that never leads.
    this.metrics.trackLeader(() => this.isLeading());
    // The variable the source provider switches on, so the two cannot disagree.
    if (this.config.getOrThrow('TELEMETRY_SOURCE', { infer: true }) === 'off') return;

    // Not awaited: boot never waits on the database for this, and `check` never rejects.
    // Each check is a run of its own (ADR-0014), as the simulator's ticks are.
    void runJob(() => this.lock.check());
    // `unref()`: this timer alone must not keep the process alive, in a spec or at shutdown.
    this.timer = setInterval(() => void runJob(() => this.lock.check()), LEADER_CHECK_MS);
    this.timer.unref();
  }

  /** Whether this replica holds the lead as of its last check. No query; safe to call per tick. */
  isLeading(): boolean {
    return this.lock.leading;
  }

  /** Before TypeORM closes the pool, so the leader can unlock and hand back its connection. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.lock.release();
  }
}
