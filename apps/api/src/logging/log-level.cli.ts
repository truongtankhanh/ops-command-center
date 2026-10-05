// First: the decorators of `env.validation` need it, and this entry point has no Nest to load it.
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { LOG_LEVELS, type LogLevel } from '../config/env.validation';
import dataSource from '../database/data-source';
import { LOG_LEVEL_OVERRIDE_ID } from './log-level-override.entity';

/**
 * Operator CLI for the runtime log level (ADR-0014). It writes the `log_level_override` row, which
 * every replica polls; it never talks to a replica directly. Same env loading and validation as
 * the TypeORM CLI (`data-source.ts`).
 *
 *   pnpm --filter @occ/api log-level show
 *   pnpm --filter @occ/api log-level set debug --ttl 30 --by "jane / INC-123"
 *   pnpm --filter @occ/api log-level clear
 *   docker compose exec api node dist/logging/log-level.cli.js set debug --ttl 30 --by "…"
 */

const MAX_TTL_MINUTES = 240;
const MAX_SET_BY_CHARS = 200;

const USAGE = `Usage:
  log-level show
  log-level set <${LOG_LEVELS.join('|')}> --ttl <minutes, 1-${MAX_TTL_MINUTES}> --by <who and why>
  log-level clear`;

class UsageError extends Error {}

interface OverrideRow {
  level: LogLevel;
  expires_at: Date;
  set_by: string;
  set_at: Date;
  active: boolean;
}

async function main(argv: string[]): Promise<void> {
  const { positionals, values } = parseCommandLine(argv);
  const [command, level] = positionals;

  switch (command) {
    case 'show':
      return withDatabase(show);
    case 'set': {
      const request = parseSet(level, values.ttl, values.by);
      return withDatabase(() => set(request.level, request.ttlMinutes, request.setBy));
    }
    case 'clear':
      return withDatabase(clear);
    default:
      throw new UsageError(command ? `Unknown command: ${command}` : 'No command given');
  }
}

function parseCommandLine(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: { ttl: { type: 'string' }, by: { type: 'string' } },
    });
  } catch (error) {
    // An unknown option or a missing value: the operator's mistake, not a failure.
    throw new UsageError((error as Error).message);
  }
}

function parseSet(
  level: string | undefined,
  ttl: string | undefined,
  by: string | undefined,
): { level: LogLevel; ttlMinutes: number; setBy: string } {
  if (!LOG_LEVELS.includes(level as LogLevel)) {
    throw new UsageError(`Level must be one of ${LOG_LEVELS.join(', ')}`);
  }
  const ttlMinutes = Number(ttl);
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > MAX_TTL_MINUTES) {
    throw new UsageError(`--ttl must be a whole number of minutes, 1 to ${MAX_TTL_MINUTES}`);
  }
  const setBy = by?.trim() ?? '';
  if (setBy.length === 0 || setBy.length > MAX_SET_BY_CHARS) {
    throw new UsageError(`--by is required, at most ${MAX_SET_BY_CHARS} characters`);
  }
  return { level: level as LogLevel, ttlMinutes, setBy };
}

async function withDatabase(action: () => Promise<void>): Promise<void> {
  await dataSource.initialize();
  try {
    await action();
  } finally {
    await dataSource.destroy();
  }
}

async function show(): Promise<void> {
  const [row] = (await dataSource.query(
    `SELECT "level", "expires_at", "set_by", "set_at", "expires_at" > now() AS "active"
       FROM "log_level_override" WHERE "id" = $1`,
    [LOG_LEVEL_OVERRIDE_ID],
  )) as OverrideRow[];
  if (!row?.active) {
    print('No active override: every replica runs at its boot level (LOG_LEVEL).');
    return;
  }
  print(
    `Override ${row.level} until ${row.expires_at.toISOString()}, ` +
      `set by ${row.set_by} at ${row.set_at.toISOString()}.`,
  );
}

async function set(level: LogLevel, ttlMinutes: number, setBy: string): Promise<void> {
  // The database clock sets the expiry, the same clock the replicas compare against.
  const [row] = (await dataSource.query(
    `INSERT INTO "log_level_override" ("id", "level", "expires_at", "set_by", "set_at")
     VALUES ($1, $2, now() + make_interval(mins => $3), $4, now())
     ON CONFLICT ("id") DO UPDATE
       SET "level" = EXCLUDED."level", "expires_at" = EXCLUDED."expires_at",
           "set_by" = EXCLUDED."set_by", "set_at" = EXCLUDED."set_at"
     RETURNING "expires_at"`,
    [LOG_LEVEL_OVERRIDE_ID, level, ttlMinutes, setBy],
  )) as Pick<OverrideRow, 'expires_at'>[];
  print(
    `Override ${level} until ${row!.expires_at.toISOString()}. ` +
      'Every replica applies it within 15 s.',
  );
}

async function clear(): Promise<void> {
  await dataSource.query(`DELETE FROM "log_level_override" WHERE "id" = $1`, [
    LOG_LEVEL_OVERRIDE_ID,
  ]);
  print('Override cleared. Every replica returns to its boot level within 15 s.');
}

/** Output for the operator at the terminal, not an application log. */
function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  process.stderr.write(`log-level failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
