import { minutes, seconds } from '@nestjs/throttler';

/**
 * Every rate limit the API applies. All but the telemetry watch limit are per authenticated user
 * and per route, in fixed windows counted by `ThrottlerGuard` (ADR-0012); that one is per socket,
 * in a rolling window, and counted by the gateway itself (ADR-0019). Changing one is a reviewed
 * decision: write down why in the ADR.
 */
export interface RateLimit {
  ttl: number;
  limit: number;
}

/** Reads and anything without its own limit: far above what a person at a console sends. */
export const DEFAULT_RATE_LIMIT: RateLimit = { ttl: minutes(1), limit: 120 };

/** `POST /incidents`: a write that fans out to every console; people type incidents one by one. */
export const REPORT_INCIDENT_RATE_LIMIT: RateLimit = { ttl: minutes(1), limit: 10 };

/** Acknowledge and resolve, each its own bucket: room for a supervisor clearing a queue. */
export const TRANSITION_INCIDENT_RATE_LIMIT: RateLimit = { ttl: minutes(1), limit: 30 };

/**
 * `GET /cameras/:id/stream`: cheap, and called once per camera a console opens, so it grows with
 * the camera count (a video wall, a VMS inventory) rather than with what people do.
 */
export const CAMERA_STREAM_RATE_LIMIT: RateLimit = { ttl: minutes(1), limit: 300 };

/**
 * `telemetry.watch`, per socket (ADR-0019). `ThrottlerGuard` never sees this one: a socket message
 * has no HTTP request to key on, and the handler opts out of it. The gateway counts it in memory
 * (`SlidingWindowLimiter`), so it is not switched off by `RATE_LIMIT_ENABLED`: it bounds what one
 * open socket can make the process do, not a user's quota. A console that debounces its watch set
 * never comes near it.
 */
export const TELEMETRY_WATCH_RATE_LIMIT: RateLimit = { ttl: seconds(1), limit: 5 };
