import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { LogLevel } from '../config/env.validation';

/** The only row's id: there is at most one override at a time. */
export const LOG_LEVEL_OVERRIDE_ID = 1;

/**
 * A temporary log level for every replica (ADR-0014). Written by the `log-level` CLI and read by
 * `LogLevelService` on each replica. Once `expiresAt` passes, the row is ignored: every replica is
 * back at its boot level, even if nobody clears the row.
 */
@Entity('log_level_override')
export class LogLevelOverrideEntity {
  @PrimaryColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 8 })
  level: LogLevel;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** Who raised it and why, as the operator typed it, e.g. `jane / INC-123`. */
  @Column({ name: 'set_by', type: 'varchar', length: 200 })
  setBy: string;

  @Column({ name: 'set_at', type: 'timestamptz' })
  setAt: Date;
}
