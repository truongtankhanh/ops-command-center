import type { EventEmitter } from 'node:events';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { releaseAdvisoryLock, tryAdvisoryLock } from '../database/advisory-locks';

/** The parts of the underlying `pg` client used here. */
interface PgClient extends EventEmitter {
  end(): Promise<void>;
}

interface LockConnection {
  runner: QueryRunner;
  client: PgClient;
}

/**
 * Elects one simulator across all API replicas (ADR-0008). The leader holds a session-level
 * advisory lock on a connection of its own. If its process dies, Postgres releases the lock with
 * the session and another replica takes over at its next check.
 */
@Injectable()
export class SimulatorLeader {
  private readonly logger = new Logger(SimulatorLeader.name);
  private connection?: LockConnection;
  private leading = false;
  private checking?: Promise<boolean>;
  private stopped = false;

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Call before every tick. A non-leader tries to take the lead; the leader confirms its session
   * (and so its lock) is still alive. Never rejects: a database error counts as not leading.
   */
  isLeader(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    this.checking ??= this.check().finally(() => {
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
      if (this.leading) await releaseAdvisoryLock(connection.runner, 'Simulator');
      this.forget();
      await connection.runner.release();
    } catch {
      this.discard();
    }
  }

  private async check(): Promise<boolean> {
    try {
      if (this.leading && this.connection) {
        await this.connection.runner.query('SELECT 1');
        return true;
      }
      const runner = this.connection?.runner ?? (await this.connect());
      this.leading = await tryAdvisoryLock(runner, 'Simulator');
      if (this.leading) this.logger.log('Simulator leadership acquired');
      return this.leading;
    } catch (error) {
      this.lose(error as Error);
      return false;
    }
  }

  /** Opened on the first check only, so replicas with the simulator off never hold one. */
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
    if (this.leading && !this.stopped) {
      this.logger.warn(`Simulator leadership lost: ${error?.message ?? 'connection closed'}`);
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
    this.leading = false;
  }
}
