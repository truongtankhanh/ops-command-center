import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DataSource, In, IsNull, LessThan } from 'typeorm';
import { runJob } from '../logging/request-context';
import { OUTBOX_CHANNEL } from './outbox-events';
import { OutboxEntity } from './outbox.entity';

/** Fallback for rows no nudge announced: written by a process that died, or by another instance. */
const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 100;
const RETENTION_MS = 24 * 60 * 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;

/**
 * Publishes pending outbox rows to every API replica (ADR-0007, ADR-0008). Each batch is claimed,
 * announced with one `NOTIFY` of its ids and marked published in a single transaction. Postgres
 * delivers the notification only when that transaction commits, to every replica's
 * `OutboxListener`, which emits the events on its own bus. A batch that fails to commit stays
 * pending and is announced again, so delivery is at-least-once and listeners must tolerate
 * duplicates.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private pollTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private draining?: Promise<void>;
  private cleaning?: Promise<void>;
  private drainAgain = false;
  private stopped = false;

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    this.pollTimer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
    this.cleanupTimer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    void this.drain(); // rows a previous process committed but never published
  }

  /** Runs before TypeORM closes the connection, so the batch in flight can still commit. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.cleanupTimer);
    await Promise.all([this.draining, this.cleaning]);
  }

  /**
   * Publishes every pending row. Call it after committing a write. Calls never overlap, and a call
   * made during a drain is not lost: the running drain makes one more pass. Never rejects.
   */
  drain(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.draining) {
      this.drainAgain = true;
      return this.draining;
    }
    // A run of its own (ADR-0014): the request that triggered it does not own the other rows.
    this.draining = runJob(() => this.drainUntilEmpty()).finally(() => {
      this.draining = undefined;
      // A call that arrived after the last pass checked `drainAgain` still gets its pass.
      if (this.drainAgain) void this.drain();
    });
    return this.draining;
  }

  private async drainUntilEmpty(): Promise<void> {
    try {
      do {
        this.drainAgain = false;
        let published: number;
        do {
          published = await this.publishBatch();
        } while (published === BATCH_SIZE && !this.stopped);
      } while (this.drainAgain && !this.stopped);
    } catch (error) {
      // Rows stay pending; the next poll retries them.
      this.logger.error(`Outbox drain failed: ${(error as Error).message}`, (error as Error).stack);
    }
  }

  /** Claims, announces and marks one batch in one transaction. Returns the number of rows. */
  private publishBatch(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      // SKIP LOCKED: another instance's in-flight batch is skipped, not waited for.
      const rows = await manager.find(OutboxEntity, {
        select: { id: true },
        where: { publishedAt: IsNull() },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });
      if (rows.length === 0) return 0;

      const ids = rows.map((row) => row.id);
      // Ids, not payloads: a NOTIFY payload is capped at 8000 bytes, which a long incident
      // description can exceed. Listeners read the rows by id.
      await manager.query('SELECT pg_notify($1, $2)', [OUTBOX_CHANNEL, JSON.stringify(ids)]);
      await manager.update(OutboxEntity, { id: In(ids) }, { publishedAt: () => 'now()' });
      return rows.length;
    });
  }

  private cleanup(): Promise<void> {
    this.cleaning ??= runJob(() => this.deleteExpired()).finally(() => {
      this.cleaning = undefined;
    });
    return this.cleaning;
  }

  private async deleteExpired(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_MS);
      await this.dataSource.getRepository(OutboxEntity).delete({ publishedAt: LessThan(cutoff) });
    } catch (error) {
      this.logger.warn(`Outbox cleanup failed: ${(error as Error).message}`);
    }
  }
}
