import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runJob } from '../logging/request-context';
import { IdempotencyKeyEntity } from './idempotency-key.entity';

const CLEANUP_INTERVAL_MS = 60 * 60_000;

/**
 * Deletes expired idempotency keys (ADR-0009). Lookups already ignore them, so this only bounds the
 * table's size. Every replica runs it; concurrent deletes of the same rows are harmless.
 */
@Injectable()
export class IdempotencyKeyCleanup implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(IdempotencyKeyCleanup.name);
  private timer?: NodeJS.Timeout;
  private cleaning?: Promise<void>;

  constructor(private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  /** Runs before TypeORM closes the connection, so a delete in flight can finish. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.cleaning;
  }

  private cleanup(): Promise<void> {
    this.cleaning ??= runJob(() => this.deleteExpired()).finally(() => {
      this.cleaning = undefined;
    });
    return this.cleaning;
  }

  private async deleteExpired(): Promise<void> {
    try {
      // The database clock, the same one `claimIdempotencyKey` compares against.
      await this.dataSource
        .createQueryBuilder()
        .delete()
        .from(IdempotencyKeyEntity)
        .where('expires_at <= now()')
        .execute();
    } catch (error) {
      this.logger.warn(`Idempotency key cleanup failed: ${(error as Error).message}`);
    }
  }
}
