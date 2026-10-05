import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * The correlation id of the HTTP request or job run this code works for (ADR-0014). Every log line
 * written inside carries it as `requestId`, and the outbox rows written inside store it.
 */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Runs `fn`, and everything it awaits, with `requestId` as the correlation id. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/**
 * Runs `fn` as a unit of work of its own, under a fresh id, whatever context the caller was in.
 * For timer ticks and for work a request only triggers, such as an outbox drain that also publishes
 * other requests' rows.
 */
export function runJob<T>(fn: () => T): T {
  return runWithRequestId(randomUUID(), fn);
}
