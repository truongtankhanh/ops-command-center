import type { RateLimit } from '../rate-limit/rate-limits';

/**
 * Admits at most `limit` calls in any rolling `ttl`, for one caller (ADR-0019: "5 per second per
 * socket"). It keeps the times of the last `limit` admitted calls and nothing else, so its memory
 * is fixed whatever the caller sends.
 *
 * Not a token bucket on purpose: a bucket refilling at the same rate admits a full burst, then
 * another a window later, which is twice the stated limit across a window boundary.
 *
 * The clock is a parameter so a spec needs no fake timers. A clock that moves backwards refuses
 * calls instead of throwing: this runs on every message of an open socket.
 */
export class SlidingWindowLimiter {
  /** Times of the admitted calls. Once full it is a ring: `oldest` is the slot to replace next. */
  private readonly admitted: number[] = [];
  private oldest = 0;

  constructor(private readonly rate: RateLimit) {}

  /** `true` and counted when the call is admitted; `false` and not counted when it is refused. */
  tryTake(nowMs: number): boolean {
    const { limit, ttl } = this.rate;
    if (this.admitted.length < limit) {
      this.admitted.push(nowMs);
      return true;
    }
    const oldestAt = this.admitted[this.oldest];
    // `undefined` only when `limit` is 0: nothing is ever admitted.
    if (oldestAt === undefined || nowMs - oldestAt < ttl) return false;
    this.admitted[this.oldest] = nowMs;
    this.oldest = (this.oldest + 1) % limit;
    return true;
  }
}
