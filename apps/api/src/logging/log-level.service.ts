import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import type { Logger as PinoRoot } from 'pino';
import { Repository } from 'typeorm';
import type { Env, LogLevel } from '../config/env.validation';
import { LOG_LEVEL_OVERRIDE_ID, LogLevelOverrideEntity } from './log-level-override.entity';
import { runJob } from './request-context';

/** Worst case between `log-level set` and every replica logging at the new level. */
const POLL_INTERVAL_MS = 15_000;

/**
 * Applies the `log_level_override` row to this replica's logger, and drops it once it expires
 * (ADR-0014). Every replica polls the same row, so one `log-level set` reaches them all. Each
 * replica logs one `warn` per change, which is the record of who raised the level and until when.
 */
@Injectable()
export class LogLevelService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(LogLevelService.name);
  private readonly bootLevel: LogLevel;
  private timer?: NodeJS.Timeout;
  private polling?: Promise<void>;
  /** The override in force here, as `level|expiresAt|setBy`; `undefined` at the boot level. */
  private applied?: string;
  private failing = false;

  constructor(
    config: ConfigService<Env, true>,
    @InjectRepository(LogLevelOverrideEntity)
    private readonly overrides: Repository<LogLevelOverrideEntity>,
  ) {
    this.bootLevel = config.get('LOG_LEVEL', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    void this.poll(); // an override set before this replica started
  }

  /** Runs before TypeORM closes the connection, so a poll in flight can finish. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.polling;
  }

  private poll(): Promise<void> {
    this.polling ??= runJob(() => this.refresh()).finally(() => {
      this.polling = undefined;
    });
    return this.polling;
  }

  /** Never rejects. On a database error the current level stays until the next poll succeeds. */
  private async refresh(): Promise<void> {
    let active: LogLevelOverrideEntity | null;
    try {
      // The database clock decides expiry, the same one for every replica.
      active = await this.overrides
        .createQueryBuilder('override')
        .where('override.id = :id', { id: LOG_LEVEL_OVERRIDE_ID })
        .andWhere('override.expiresAt > now()')
        .getOne();
    } catch (error) {
      if (!this.failing) {
        this.failing = true;
        this.logger.warn(`Cannot read the log level override: ${(error as Error).message}`);
      }
      return;
    }
    if (this.failing) {
      this.failing = false;
      this.logger.log('Log level override readable again');
    }
    this.apply(active);
  }

  private apply(active: LogLevelOverrideEntity | null): void {
    const key = active
      ? `${active.level}|${active.expiresAt.toISOString()}|${active.setBy}`
      : undefined;
    if (key === this.applied) return;
    // Unset only when `LoggerModule` is not loaded, as in a unit test: nothing to change then.
    const root = PinoLogger.root as PinoRoot | undefined;
    if (!root) return;

    this.applied = key;
    if (active) {
      root.level = active.level;
      this.logger.warn(
        `Log level ${active.level} until ${active.expiresAt.toISOString()}, set by ${active.setBy}`,
      );
    } else {
      root.level = this.bootLevel;
      this.logger.warn(`Log level back to ${this.bootLevel}: override expired or cleared`);
    }
  }
}
