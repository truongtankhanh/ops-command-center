import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Env } from '../../config/env.validation';
import { runJob } from '../../logging/request-context';
import { bucketOf, SAMPLE_TABLE } from './sample-partitions';
import { type TelemetryChange, TelemetryIngestService } from '../ingest/telemetry-ingest.service';
import { TelemetryLeader } from '../ingest/telemetry-leader.service';
import { TelemetrySamplePartitions } from './telemetry-sample-partitions.service';

/**
 * How often the leader writes: one flush is one 5 s bucket (ADR-0018). A constant, not a
 * variable, as `LEADER_CHECK_MS`; it is the second half of the task's Open question 6.
 */
export const SAMPLE_FLUSH_MS = 5_000;

/** `check_violation`: what PostgreSQL raises for a row that no partition of the table accepts. */
const NO_PARTITION = '23514';

// One round trip for the whole flush. `||` is a shallow jsonb merge in which the later key wins,
// which is "the last value of each key in the bucket" and lets two flushes in one bucket leave one
// row. `"values"` is quoted: it is a keyword.
const UPSERT =
  `INSERT INTO "${SAMPLE_TABLE}" ("asset_id", "bucket_at", "values") ` +
  `SELECT * FROM unnest($1::uuid[], $2::timestamptz[], $3::jsonb[]) ` +
  `ON CONFLICT ("asset_id", "bucket_at") DO UPDATE ` +
  `SET "values" = "${SAMPLE_TABLE}"."values" || EXCLUDED."values"`;

/**
 * Writes the reading history (ADR-0018, ADR-0019): on the telemetry leader only, every 5 s, one
 * row per asset that received a key since the last successful write, stamped with the bucket the
 * writer saw it arrive in. It reads the ingest service through a cursor of its own
 * (`changedSince`), which moves only after a write succeeded, so a failed flush is retried with
 * the same keys and their newest values.
 *
 * Best effort, like everything on the telemetry path: a long outage is repaired by the first
 * successful flush writing the latest value of each key once, so the table is not a complete
 * record. Rows are stamped with the writer's bucket, never the device's `at`: a device clock
 * skewed by minutes cannot reach another day's partition.
 *
 * A replica that gains the lead first keeps the partitions up (`TelemetrySamplePartitions`), then
 * starts its cursor at the ingest service's current version: it writes what arrives from then on
 * and never re-stamps an old value as fresh. A failover therefore leaves a gap of about one flush.
 */
@Injectable()
export class TelemetrySampleWriter implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(TelemetrySampleWriter.name);
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;
  private cursor = 0;
  private wasLeading = false;
  private failing = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
    private readonly ingest: TelemetryIngestService,
    private readonly leader: TelemetryLeader,
    private readonly partitions: TelemetrySamplePartitions,
  ) {}

  onApplicationBootstrap(): void {
    // A replica with no source never leads, so a timer would only wake to return.
    if (this.config.getOrThrow('TELEMETRY_SOURCE', { infer: true }) === 'off') return;
    // Each flush is a run of its own (ADR-0014), as the simulator's ticks are.
    this.timer = setInterval(() => void runJob(() => this.flush()), SAMPLE_FLUSH_MS);
    // `unref()`: this timer alone must not keep the process alive, in a spec or at shutdown.
    this.timer.unref();
  }

  /**
   * Before TypeORM closes the pool, so a flush in flight finishes first. No final flush: at most
   * one bucket is lost on a clean stop, which a failover loses anyway.
   */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.flushing;
  }

  /** One flush. Public so it can be driven directly in tests. Never rejects; overlaps share one. */
  flush(now: Date = new Date()): Promise<void> {
    this.flushing ??= this.run(now).finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async run(now: Date): Promise<void> {
    try {
      if (!this.leader.isLeading()) {
        this.wasLeading = false;
        return;
      }
      if (!this.wasLeading) {
        await this.partitions.maintain(now);
        this.cursor = this.ingest.changedSince(Number.MAX_SAFE_INTEGER).version;
        this.wasLeading = true;
        return;
      }

      const { version, changes } = this.ingest.changedSince(this.cursor);
      if (changes.length > 0) {
        await this.write(changes, bucketOf(now), now);
        this.logger.debug(`Wrote ${changes.length} telemetry samples`);
        // Only a write that succeeded proves the database is back.
        this.recovered();
      }
      this.cursor = version;
    } catch (error) {
      this.failed(error);
    }
  }

  /** The upsert, and when no partition took a row, one more try after creating the partitions. */
  private async write(changes: TelemetryChange[], bucket: Date, now: Date): Promise<void> {
    const parameters = [
      changes.map((change) => change.assetId),
      changes.map(() => bucket.toISOString()),
      changes.map((change) => JSON.stringify(change.values)),
    ];
    try {
      await this.dataSource.query(UPSERT, parameters);
    } catch (error) {
      if (!isMissingPartition(error)) throw error;
      // A clock edge, or a database no leader has kept since its migration.
      await this.partitions.ensure(now);
      await this.dataSource.query(UPSERT, parameters);
    }
  }

  /** Once per change: an outage is one line, not one per 5 s. */
  private failed(error: unknown): void {
    if (this.failing) return;
    this.failing = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Telemetry sample write failed, will retry: ${reason}`);
  }

  private recovered(): void {
    if (!this.failing) return;
    this.failing = false;
    this.logger.log('Telemetry sample writes recovered');
  }
}

function isMissingPartition(error: unknown): boolean {
  const { code, driverError } = error as { code?: string; driverError?: { code?: string } };
  return (code ?? driverError?.code) === NO_PARTITION;
}
