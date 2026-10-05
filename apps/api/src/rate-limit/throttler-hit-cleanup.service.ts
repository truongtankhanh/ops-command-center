import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runJob } from '../logging/request-context';

const CLEANUP_INTERVAL_MS = 10 * 60_000;

/**
 * Deletes rate-limit counters whose window and block are both over (ADR-0012). The storage already
 * restarts such rows on the next hit, so this only bounds the table's size. Every replica runs it;
 * concurrent deletes of the same rows are harmless.
 */
@Injectable()
export class ThrottlerHitCleanup implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(ThrottlerHitCleanup.name);
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
      // The database clock, the same one `PostgresThrottlerStorage` compares against.
      await this.dataSource.query(
        `DELETE FROM "throttler_hit"
          WHERE "expires_at" <= now() AND ("blocked_until" IS NULL OR "blocked_until" <= now())`,
      );
    } catch (error) {
      this.logger.warn(`Rate-limit counter cleanup failed: ${(error as Error).message}`);
    }
  }
}
