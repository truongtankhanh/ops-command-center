import type { Camera } from '@occ/contracts';

/** Tiles in the camera strip, and so the most cameras that can be pinned to it. */
export const STRIP_SIZE = 4;

const PINNED_KEY = 'occ.console.pinnedCameras';

/** Online cameras in the given zone first, then the rest; offline cameras last. */
export function prioritise(cameras: Camera[], zoneId: string | undefined): Camera[] {
  const score = (c: Camera) => (c.zoneId === zoneId ? 0 : 1) + (c.online ? 0 : 2);
  return [...cameras].sort((a, b) => score(a) - score(b) || a.code.localeCompare(b.code));
}

/**
 * The strip's tiles: pinned cameras that still exist first, in pin order, then the others in
 * `prioritise` order — so a pinned camera keeps its slot whatever incident is selected.
 */
export function stripCameras(
  cameras: Camera[],
  zoneId: string | undefined,
  pinnedIds: readonly string[],
): Camera[] {
  const byId = new Map(cameras.map((c) => [c.id, c]));
  const pinned = pinnedIds.flatMap((id) => byId.get(id) ?? []);
  const rest = prioritise(
    cameras.filter((c) => !pinnedIds.includes(c.id)),
    zoneId,
  );
  return [...pinned, ...rest].slice(0, STRIP_SIZE);
}

/** Pins whose camera still exists. */
function livePins(pinned: readonly string[], knownIds: readonly string[]): string[] {
  return pinned.filter((id) => knownIds.includes(id));
}

/**
 * Pins `id`, or unpins it when it is pinned. Ids missing from `knownIds` are dropped first: a
 * reseeded database gives every camera a new id, and stale pins must not keep the strip full.
 * Pinning past `STRIP_SIZE` leaves the list unchanged.
 */
export function togglePinned(
  pinned: readonly string[],
  id: string,
  knownIds: readonly string[],
): string[] {
  const live = livePins(pinned, knownIds);
  if (live.includes(id)) return live.filter((p) => p !== id);
  return live.length < STRIP_SIZE ? [...live, id] : live;
}

/** Whether `id` can be toggled: it is pinned (so it can be unpinned), or the strip has room. */
export function canPin(
  pinned: readonly string[],
  id: string,
  knownIds: readonly string[],
): boolean {
  const live = livePins(pinned, knownIds);
  return live.includes(id) || live.length < STRIP_SIZE;
}

/**
 * What a camera frame shows. The descriptor's `kind` is not looked at here: `StreamView` stays the
 * only switch on it (ADR-0002), so `stream` means "a descriptor arrived", whatever its kind.
 */
export type FeedState = 'offline' | 'unavailable' | 'pending' | 'stream';

/**
 * `query` is the stream's `useQuery` result. A retry of a request that failed with no data puts
 * the query back to `pending` and clears its error (TanStack Query v5), so a past error
 * (`errorUpdatedAt`) keeps the frame `unavailable` until a descriptor arrives: the Retry button
 * stays where it was, busy, instead of a skeleton taking its place and its focus.
 */
export function feedState(
  online: boolean,
  query: { data?: unknown; isError: boolean; errorUpdatedAt?: number },
): FeedState {
  if (!online) return 'offline';
  if (query.data === undefined) {
    return query.isError || (query.errorUpdatedAt ?? 0) > 0 ? 'unavailable' : 'pending';
  }
  return query.isError ? 'unavailable' : 'stream';
}

/** `HH:MM:SS`, 24 h, local — the time shown on a camera frame. */
export function formatCameraTime(now: number): string {
  return new Date(now).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Pinned camera ids remembered in this browser. Storage can be unavailable (private mode, blocked
 * by policy) or hold anything, so a failed read or a malformed value gives no pins.
 */
export function readPinnedCameras(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]');
    return Array.isArray(value) && value.every((id) => typeof id === 'string') ? value : [];
  } catch {
    return [];
  }
}

export function writePinnedCameras(ids: readonly string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
  } catch {
    // Not remembered: the pins still hold until the page reloads.
  }
}
