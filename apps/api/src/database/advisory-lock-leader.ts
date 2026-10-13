import type { EventEmitter } from 'node:events';
import type { Logger } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { type AdvisoryLockName, releaseAdvisoryLock, tryAdvisoryLock } from './advisory-locks';

/** The parts of the underlying `pg` client used here. */
interface PgClient extends EventEmitter {
  end(): Promise<void>;
}

interface LockConnection {
  runner: QueryRunner;
  client: PgClient;
}

export interface AdvisoryLockLeaderOptions {
  /** The key in `AdvisoryLocks` this leader competes for. */
  lock: AdvisoryLockName;
  /** Opens the log lines: `<label> leadership acquired` and `<label> leadership lost: …`. */
  label: string;
  /** The owner's logger, so its lines keep the owner's context. */
  logger: Logger;
}

/**
 * Elects one holder of a session-level advisory lock across all API replicas (ADR-0008,
 * ADR-0019). The leader keeps the lock on a connection of its own. If its process dies, Postgres
 * releases the lock with the session and another replica takes over at its next check.
 *
 * Not an injectable on purpose: each leader owns one (`SimulatorLeader`, `TelemetryLeader`) and
 * decides when to check, so no DI metadata sits on a shared base class.
 */
export class AdvisoryLockLeader {
  private connection?: LockConnection;
  private isLeading = false;
  private checking?: Promise<boolean>;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly options: AdvisoryLockLeaderOptions,
  ) {}

  /**
   * Whether this replica holds the lock as of the last check. No query: it reads what `check`
   * keeps, and is `false` as soon as the connection is lost.
   */
  get leading(): boolean {
    return this.isLeading;
  }

  /**
   * One check. A non-leader tries to take the lead; the leader confirms its session (and so its
   * lock) is still alive. Never rejects: a database error counts as not leading. Concurrent calls
   * share one round trip.
   */
  check(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    this.checking ??= this.run().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  /** Gives up the lead and the connection. Runs before TypeORM closes the pool. */
  async release(): Promise<void> {
    this.stopped = true;
    await this.checking;
    const connection = this.connection;
    if (!connection) return;
    try {
      if (this.isLeading) await releaseAdvisoryLock(connection.runner, this.options.lock);
      this.forget();
      await connection.runner.release();
    } catch {
      this.discard();
    }
  }

  private async run(): Promise<boolean> {
    try {
      if (this.isLeading && this.connection) {
        await this.connection.runner.query('SELECT 1');
        return true;
      }
      const runner = this.connection?.runner ?? (await this.connect());
      this.isLeading = await tryAdvisoryLock(runner, this.options.lock);
      if (this.isLeading) this.options.logger.log(`${this.options.label} leadership acquired`);
      return this.isLeading;
    } catch (error) {
      this.lose(error as Error);
      return false;
    }
  }

  /** Opened on the first check only, so a replica that never checks never holds one. */
  private async connect(): Promise<QueryRunner> {
    const runner = this.dataSource.createQueryRunner();
    try {
      const client = (await runner.connect()) as PgClient;
      client.on('error', this.lose);
      client.on('end', this.lose);
      this.connection = { runner, client };
      return runner;
    } catch (error) {
      await runner.release();
      throw error;
    }
  }

  /** Connection error or end, or a failed check. `error` and `end` both fire for one loss. */
  private readonly lose = (error?: Error): void => {
    if (!this.connection) return;
    if (this.isLeading && !this.stopped) {
      this.options.logger.warn(
        `${this.options.label} leadership lost: ${error?.message ?? 'connection closed'}`,
      );
    }
    this.discard();
  };

  /**
   * Closes the session instead of returning it to the pool. A pooled session that still held the
   * lock would keep every replica, this one included, from ever leading again.
   */
  private discard(): void {
    const connection = this.connection;
    this.forget();
    if (!connection) return;
    connection.client.end().catch(() => undefined); // already closed is fine
    void connection.runner.release();
  }

  private forget(): void {
    if (this.connection) {
      this.connection.client.off('error', this.lose);
      this.connection.client.off('end', this.lose);
    }
    this.connection = undefined;
    this.isLeading = false;
  }
}
