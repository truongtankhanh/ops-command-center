import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import type { RequestWithUser } from '../auth/auth.decorators';
import type { Env } from '../config/env.validation';
import { PostgresThrottlerStorage } from './postgres-throttler-storage';
import { DEFAULT_RATE_LIMIT } from './rate-limits';
import { ThrottlerHitCleanup } from './throttler-hit-cleanup.service';

/**
 * Who a request counts against. `ThrottlerGuard` runs after `AuthGuard` (see `AuthModule`), so
 * every route but a `@Public()` one has a user: one person behind a shared control-room IP is
 * throttled alone, and changing IP does not reset their count. nginx limits by IP in front of the
 * API, for traffic that never authenticates (ADR-0012).
 */
function trackerOf(req: RequestWithUser): string {
  return req.user ? `sub:${req.user.subject}` : `ip:${req.ip}`;
}

/**
 * Rate limiting for every HTTP route (ADR-0012): one `default` throttler, so a refused request
 * carries a plain `Retry-After`, with its counters in PostgreSQL, shared by every replica.
 * Routes that need a different limit use `@Throttle({ default: … })` with a value from
 * `rate-limits.ts`; probes opt out with `@SkipThrottle()`. The guard itself is registered in
 * `AuthModule`, which fixes the order of the global guards.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, DataSource],
      useFactory: (
        config: ConfigService<Env, true>,
        dataSource: DataSource,
      ): ThrottlerModuleOptions => {
        const enabled = config.get('RATE_LIMIT_ENABLED', { infer: true });
        return {
          throttlers: [{ name: 'default', ...DEFAULT_RATE_LIMIT }],
          storage: new PostgresThrottlerStorage(dataSource),
          errorMessage: 'Too many requests. Try again shortly.',
          skipIf: () => !enabled,
          getTracker: (req) => trackerOf(req as RequestWithUser),
        };
      },
    }),
  ],
  providers: [ThrottlerHitCleanup],
})
export class RateLimitModule {}
