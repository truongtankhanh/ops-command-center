import type { ThrottlerStorage } from '@nestjs/throttler';
import type { DataSource } from 'typeorm';

/** What `increment` resolves to; the package declares it but does not export it from its root. */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * One fixed window per key. Three cases, all decided on the row's old values:
 * - still blocked: nothing changes, the request is refused;
 * - window over, or a block just ended: a new window starts with this request as its first hit;
 * - otherwise: one more hit, and a block starts once the count passes the limit.
 * `ON CONFLICT` locks the row, so concurrent requests for one key are counted one after another.
 * Times come from the database clock, so replicas with skewed clocks agree.
 */
const INCREMENT = `
  INSERT INTO "throttler_hit" AS t ("key", "hits", "expires_at", "blocked_until")
  VALUES ($1, 1, now() + $2::int * interval '1 millisecond', NULL)
  ON CONFLICT ("key") DO UPDATE SET
    "hits" = CASE
      WHEN t."blocked_until" > now() THEN t."hits"
      WHEN t."expires_at" <= now() OR t."blocked_until" IS NOT NULL THEN 1
      ELSE t."hits" + 1
    END,
    "expires_at" = CASE
      WHEN t."blocked_until" > now() THEN t."expires_at"
      WHEN t."expires_at" <= now() OR t."blocked_until" IS NOT NULL THEN EXCLUDED."expires_at"
      ELSE t."expires_at"
    END,
    "blocked_until" = CASE
      WHEN t."blocked_until" > now() THEN t."blocked_until"
      WHEN t."expires_at" <= now() OR t."blocked_until" IS NOT NULL THEN NULL
      WHEN $4::int > 0 AND t."hits" + 1 > $3::int THEN now() + $4::int * interval '1 millisecond'
      ELSE NULL
    END
  RETURNING
    "hits",
    ceil(extract(epoch FROM "expires_at" - now()))::int AS "time_to_expire",
    ceil(extract(epoch FROM coalesce("blocked_until", now()) - now()))::int AS "time_to_block_expire"`;

interface IncrementRow {
  hits: number;
  time_to_expire: number;
  time_to_block_expire: number;
}

/**
 * `@nestjs/throttler` storage in PostgreSQL, so every API replica shares one counter per key
 * (ADR-0012). In-memory storage would count per process and multiply the limit by the replica
 * count. A database error propagates and fails the request: every throttled route needs the same
 * database anyway.
 */
export class PostgresThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly dataSource: DataSource) {}

  /** `ttl` and `blockDuration` in milliseconds; the returned times in whole seconds, rounded up. */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    const [row] = (await this.dataSource.query(INCREMENT, [
      key,
      ttl,
      limit,
      blockDuration,
    ])) as IncrementRow[];
    const blocked = row.time_to_block_expire > 0;
    // Without a block duration a request is refused only while its window is over the limit.
    const overLimit = blockDuration <= 0 && row.hits > limit;
    return {
      totalHits: row.hits,
      timeToExpire: row.time_to_expire,
      isBlocked: blocked || overLimit,
      timeToBlockExpire: overLimit ? row.time_to_expire : row.time_to_block_expire,
    };
  }
}
