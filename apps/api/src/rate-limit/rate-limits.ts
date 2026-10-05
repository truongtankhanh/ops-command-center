import { minutes } from '@nestjs/throttler';

/**
 * Every rate limit the API applies, per authenticated user and per route, in fixed windows
 * (ADR-0012). Changing one is a reviewed decision: write down why in the ADR.
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
