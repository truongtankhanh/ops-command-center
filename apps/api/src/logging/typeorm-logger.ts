import { Logger } from '@nestjs/common';
import type { Logger as TypeOrmLoggerContract } from 'typeorm';

/** Long statements are cut: the log needs to recognise the query, not to replay it. */
const MAX_QUERY_CHARS = 1_000;

/**
 * TypeORM's logs through Nest's logger, so they get the app's format, redaction and `requestId`
 * (ADR-0014). Warnings, migrations and slow queries only. Query parameters are never logged: they
 * carry user input and personal data. Failed queries are not logged here either: the caller
 * handles them, and an expected unique violation (ADR-0009) is not an error.
 */
export class TypeOrmLogger implements TypeOrmLoggerContract {
  private readonly logger = new Logger('TypeORM');

  logQuery(): void {}

  logQueryError(): void {}

  logQuerySlow(time: number, query: string): void {
    this.logger.warn(`Slow query (${time} ms): ${truncate(query)}`);
  }

  logSchemaBuild(): void {}

  logMigration(message: string): void {
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') this.logger.warn(String(message));
  }
}

function truncate(query: string): string {
  const oneLine = query.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_QUERY_CHARS ? `${oneLine.slice(0, MAX_QUERY_CHARS)}…` : oneLine;
}
