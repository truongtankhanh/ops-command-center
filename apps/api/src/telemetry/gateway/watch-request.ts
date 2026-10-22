import { TELEMETRY_WATCH_LIMIT } from '@occ/contracts';

/**
 * How many entries of a watch list are looked at. The list is a client's input on a socket that
 * every console, a `viewer` included, can open: what is past this is ignored, not checked.
 */
export const MAX_WATCH_CODES_READ = 32;

/**
 * The asset codes a `telemetry.watch` payload asks for, once it has been checked (ADR-0019).
 * `payload` is whatever the client sent, so nothing about it is assumed and this never throws.
 *
 * Entries that are not strings, repeat an earlier one, or are not known are dropped **before** the
 * limit is applied, so a junk entry never uses up a slot. The order is the request's, and the
 * first `limit` survivors are kept.
 */
export function readWatchCodes(
  payload: unknown,
  isKnown: (code: string) => boolean,
  limit: number = TELEMETRY_WATCH_LIMIT,
): string[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];
  const { assets } = payload as { assets?: unknown };
  if (!Array.isArray(assets)) return [];

  const codes: string[] = [];
  for (const entry of assets.slice(0, MAX_WATCH_CODES_READ) as unknown[]) {
    if (codes.length >= limit) break;
    if (typeof entry !== 'string' || codes.includes(entry) || !isKnown(entry)) continue;
    codes.push(entry);
  }
  return codes;
}
