/**
 * The rules of the reading history (ADR-0018): which 5 s bucket a flush belongs to, and which daily
 * partitions exist, are wanted and have expired. Pure and in one place, so the writer, the
 * partition service and their specs cannot disagree. A day is a UTC day: `bucket_at` is a
 * `timestamptz`, and the server's time zone must not move a partition.
 */

/** A row holds the last value of each key received in one bucket of this length. */
export const SAMPLE_BUCKET_MS = 5_000;

/** The partitioned table; a partition is `<parent>_YYYYMMDD`. */
export const SAMPLE_TABLE = 'telemetry_sample';

/** The only names the partition service will ever drop. */
export const PARTITION_NAME = /^telemetry_sample_(\d{4})(\d{2})(\d{2})$/;

const DAY_MS = 86_400_000;

/** The bucket `at` falls in: a multiple of `SAMPLE_BUCKET_MS` since the epoch, never later than it. */
export function bucketOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / SAMPLE_BUCKET_MS) * SAMPLE_BUCKET_MS);
}

/** 00:00:00.000 UTC of the day `at` falls in. */
export function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

function addDays(day: Date, days: number): Date {
  // UTC has no daylight saving, so a day is always 24 hours.
  return new Date(day.getTime() + days * DAY_MS);
}

/** `telemetry_sample_20261014` for any instant of that UTC day. */
export function partitionName(day: Date): string {
  const d = utcDay(day);
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const date = String(d.getUTCDate()).padStart(2, '0');
  return `${SAMPLE_TABLE}_${d.getUTCFullYear()}${month}${date}`;
}

/** The half-open range a day's partition holds, as ISO UTC strings. */
export function partitionRange(day: Date): { from: string; to: string } {
  const from = utcDay(day);
  return { from: from.toISOString(), to: addDays(from, 1).toISOString() };
}

/** The UTC day a partition name stands for; `undefined` for any other name or an impossible date. */
export function dayOfPartition(name: string): Date | undefined {
  const match = PARTITION_NAME.exec(name);
  if (!match) return undefined;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const day = new Date(Date.UTC(year, month - 1, date));
  // `Date.UTC` rolls 20261340 over to the next year instead of failing.
  const real =
    day.getUTCFullYear() === year && day.getUTCMonth() === month - 1 && day.getUTCDate() === date;
  return real ? day : undefined;
}

/**
 * Today and the next `daysAhead` UTC days, so a fresh database accepts writes before any leader
 * runs and a write at midnight finds its partition.
 */
export function partitionsToEnsure(now: Date, daysAhead = 2): Date[] {
  const today = utcDay(now);
  return Array.from({ length: daysAhead + 1 }, (_, offset) => addDays(today, offset));
}

/**
 * Whether a partition is past retention: its day is before `today - retentionDays`. So the last
 * `retentionDays` whole days and today are kept, and today's is never expired for a retention of 1
 * or more.
 */
export function isExpired(day: Date, now: Date, retentionDays: number): boolean {
  return utcDay(day).getTime() < addDays(utcDay(now), -retentionDays).getTime();
}
