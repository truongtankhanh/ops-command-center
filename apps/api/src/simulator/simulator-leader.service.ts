import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdvisoryLockLeader } from '../database/advisory-lock-leader';

/**
 * Elects one simulator across all API replicas (ADR-0008). The leader holds a session-level
 * advisory lock on a connection of its own; the lifecycle is `AdvisoryLockLeader`'s, shared with
 * the telemetry leader (ADR-0019). If its process dies, Postgres releases the lock with the
 * session and another replica takes over at its next check.
 */
@Injectable()
export class SimulatorLeader {
  private readonly lock: AdvisoryLockLeader;

  constructor(dataSource: DataSource) {
    this.lock = new AdvisoryLockLeader(dataSource, {
      lock: 'Simulator',
      label: 'Simulator',
      logger: new Logger(SimulatorLeader.name),
    });
  }

  /**
   * Call before every tick. A non-leader tries to take the lead; the leader confirms its session
   * (and so its lock) is still alive. Never rejects: a database error counts as not leading.
   */
  isLeader(): Promise<boolean> {
    return this.lock.check();
  }

  /** Gives up the lead and the connection. Runs before TypeORM closes the pool. */
  release(): Promise<void> {
    return this.lock.release();
  }
}
