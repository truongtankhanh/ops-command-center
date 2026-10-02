import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, IsNull, LessThan } from 'typeorm';
import { OutboxEntity } from './outbox.entity';

/** Fallback for rows no nudge announced: written by a process that died, or by another instance. */
const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 100;
const RETENTION_MS = 24 * 60 * 60_000;
const CLEANUP_INTERVAL_MS = 60 * 60_000;

/**
 * Publishes pending outbox rows on the in-process event bus, where listeners such as
 * `EventsGateway` pick them up (ADR-0007). Delivery is at-least-once: a crash between publishing
 * and committing republishes the batch, so listeners must tolerate duplicates.
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

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

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
    this.draining = this.drainUntilEmpty().finally(() => {
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

  /** Claims, publishes and marks one batch in one transaction. Returns the number of rows. */
  private publishBatch(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      // SKIP LOCKED: another instance's in-flight batch is skipped, not waited for.
      const rows = await manager.find(OutboxEntity, {
        where: { publishedAt: IsNull() },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });
      if (rows.length === 0) return 0;

      for (const row of rows) this.publish(row);
      await manager.update(
        OutboxEntity,
        { id: In(rows.map((row) => row.id)) },
        { publishedAt: () => 'now()' },
      );
      return rows.length;
    });
  }

  private publish(row: OutboxEntity): void {
    try {
      this.events.emit(row.event, row.payload);
    } catch (error) {
      // A failing listener must not hold back every later event: the row still counts as
      // published (ADR-0007). `@OnEvent` listeners already log their own errors by default.
      this.logger.error(
        `Listener failed on ${row.event} (outbox ${row.id}): ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private cleanup(): Promise<void> {
    this.cleaning ??= this.deleteExpired().finally(() => {
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
