import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Env } from '../config/env.validation';
import { runJob } from '../logging/request-context';
import {
  dayOfPartition,
  isExpired,
  PARTITION_NAME,
  partitionName,
  partitionRange,
  partitionsToEnsure,
  SAMPLE_TABLE,
} from './sample-partitions';
import { TelemetryLeader } from './telemetry-leader.service';

/** How often the leader re-checks its partitions; also run when a replica gains the lead. */
export const MAINTAIN_MS = 24 * 60 * 60_000;

/**
 * Keeps the daily partitions of `telemetry_sample` (ADR-0018, "Reading history"): today's and the
 * next two exist, and a partition past `TELEMETRY_RETENTION_DAYS` is dropped as a whole, never
 * row by row. Only the telemetry leader calls it (ADR-0019): the writer when it gains the lead,
 * and this class's own daily timer while leading.
 *
 * Nothing here rejects. A failure is logged once per change and the next run tries again; the
 * writer's missing-partition retry is the second line.
 *
 * `DROP TABLE` of a partition takes ACCESS EXCLUSIVE on the partition and on the parent, so the
 * next insert and any history read wait behind it for at most the session's 5 s `lock_timeout`.
 * A once-a-day drop of a day-old table is one short statement once it has the lock.
 */
@Injectable()
export class TelemetrySamplePartitions
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(TelemetrySamplePartitions.name);
  private timer?: NodeJS.Timeout;
  /** Runs one after another: two creates of the same partition would race on the catalogue. */
  private queue: Promise<void> = Promise.resolve();
  private maintaining?: Promise<void>;
  private failing = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
    private readonly leader: TelemetryLeader,
  ) {}

  onApplicationBootstrap(): void {
    // A replica with no source never leads, so a timer would only wake to return.
    if (this.config.getOrThrow('TELEMETRY_SOURCE', { infer: true }) === 'off') return;
    this.timer = setInterval(() => {
      if (this.leader.isLeading()) void runJob(() => this.maintain());
    }, MAINTAIN_MS);
    // `unref()`: this timer alone must not keep the process alive, in a spec or at shutdown.
    this.timer.unref();
  }

  /** Before TypeORM closes the pool, so a run in flight finishes first. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.queue;
  }

  /**
   * Creates the missing partitions of today and the next two days, then drops the expired ones.
   * Callers that overlap share one run.
   */
  maintain(now: Date = new Date()): Promise<void> {
    this.maintaining ??= this.enqueue(() => this.run(now, true)).finally(() => {
      this.maintaining = undefined;
    });
    return this.maintaining;
  }

  /** Only the creating half: the writer's answer to a write that found no partition. */
  ensure(now: Date = new Date()): Promise<void> {
    return this.enqueue(() => this.run(now, false));
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task);
    // `run` never rejects, so the chain cannot break; `task` is only ever `run`.
    this.queue = next;
    return next;
  }

  private async run(now: Date, drop: boolean): Promise<void> {
    try {
      const existing = await this.partitionNames();
      for (const day of partitionsToEnsure(now)) {
        const name = partitionName(day);
        if (existing.includes(name)) continue;
        const { from, to } = partitionRange(day);
        // Names and bounds are built from a `Date`, never from input.
        await this.dataSource.query(
          `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${SAMPLE_TABLE}" ` +
            `FOR VALUES FROM ('${from}') TO ('${to}')`,
        );
        this.logger.log(`Created telemetry sample partition ${name}`);
      }
      if (drop) await this.dropExpired(existing, now);
      this.recovered();
    } catch (error) {
      this.failed(error);
    }
  }

  private async dropExpired(existing: string[], now: Date): Promise<void> {
    const retention = this.config.getOrThrow('TELEMETRY_RETENTION_DAYS', { infer: true });
    for (const name of existing) {
      const day = dayOfPartition(name);
      // Only a partition of this table, matching the pattern, strictly before the cutoff.
      if (day === undefined || !isExpired(day, now, retention)) continue;
      await this.dataSource.query(`DROP TABLE IF EXISTS "${name}"`);
      this.logger.log(`Dropped telemetry sample partition ${name} (past ${retention} days)`);
    }
  }

  /** The partitions the parent has, by name; anything else attached to it is ignored. */
  private async partitionNames(): Promise<string[]> {
    const rows: { name: string }[] = await this.dataSource.query(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid ` +
        `WHERE i.inhparent = '${SAMPLE_TABLE}'::regclass`,
    );
    return rows.map((row) => row.name).filter((name) => PARTITION_NAME.test(name));
  }

  /** Once per change: a failure that repeats every run is one line, not one per day. */
  private failed(error: unknown): void {
    if (this.failing) return;
    this.failing = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Telemetry sample partition upkeep failed, will retry: ${reason}`);
  }

  private recovered(): void {
    if (!this.failing) return;
    this.failing = false;
    this.logger.log('Telemetry sample partition upkeep recovered');
  }
}
