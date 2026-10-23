import type { Asset, Camera, Incident, LngLat } from '@occ/contracts';
import { isInView } from '../geo';
import { compareIncidents, isActive } from '../incidents/incidents';
import type { DisplayMode } from '../useDisplayMode';

/**
 * The most cameras that can be pinned: the strip's size in its smallest mode, so every pin keeps a
 * slot in every display mode (a pin made on a wall still shows on a laptop).
 */
export const PIN_LIMIT = 4;

/** Tiles in the camera strip: more on a control-room wall, where they are seen from afar. */
export function stripSize(mode: DisplayMode): number {
  switch (mode) {
    case 'wall-4k':
      return 8;
    case 'wall':
      return 6;
    default:
      return PIN_LIMIT;
  }
}

/**
 * Tiles in the video wall's camera grid (V2-21.4): six on a wall of any size, four on a smaller window. A 4K wall is
 * the 1920 wall twice as large and not a bigger one, so the grid stays at six tiles and the active list keeps its room
 * (eight tiles at 4K, as `stripSize` has for the console, left the list one row).
 */
export function wallStripSize(mode: DisplayMode): number {
  return mode === 'wall' || mode === 'wall-4k' ? 6 : PIN_LIMIT;
}

const PINNED_KEY = 'occ.console.pinnedCameras';

/**
 * What the strip puts first after the pins: the selected incident's zone, or the selected asset
 * (V2-09.11). At most one applies; with neither the strip has no subject.
 */
export type StripSubject =
  { kind: 'zone'; zoneId: string } | { kind: 'asset'; position: LngLat; zoneId: string };

/** Why a camera is tied to the subject: it sees the asset, or it is in the subject's zone. */
export type CameraLink = 'asset' | 'zone';

/**
 * The incident's zone when an incident is selected (as before), else the selected asset, else
 * nothing. The selection keeps them exclusive, so the order only settles a state it should not hold.
 */
export function stripSubject(
  incidentZoneId: string | undefined,
  asset: Pick<Asset, 'position' | 'zoneId'> | undefined,
): StripSubject | undefined {
  if (incidentZoneId !== undefined) return { kind: 'zone', zoneId: incidentZoneId };
  if (asset !== undefined) {
    return { kind: 'asset', position: asset.position, zoneId: asset.zoneId };
  }
  return undefined;
}

/**
 * How `camera` is tied to `subject`. For an asset a camera that sees it is `asset`, whichever zone it
 * is in; one in the asset's zone that does not is `zone`. For an incident only the zone counts.
 */
export function cameraLink(camera: Camera, subject: StripSubject | undefined): CameraLink | null {
  if (subject === undefined) return null;
  if (subject.kind === 'asset' && isInView(subject.position, camera)) return 'asset';
  return camera.zoneId === subject.zoneId ? 'zone' : null;
}

/** The tier of a link: lower comes first. An offline camera is three tiers further (`prioritise`). */
const LINK_TIER: Readonly<Record<CameraLink | 'none', number>> = { asset: 0, zone: 1, none: 2 };
const OFFLINE_TIERS = 3;

/**
 * Cameras tied to the subject first (those that see the selected asset, then those in its zone),
 * then the rest; every offline camera after every online one, whatever it is tied to. Ties go by
 * code, so the strip never reshuffles between renders.
 */
export function prioritise(cameras: Camera[], subject: StripSubject | undefined): Camera[] {
  const score = (c: Camera) =>
    LINK_TIER[cameraLink(c, subject) ?? 'none'] + (c.online ? 0 : OFFLINE_TIERS);
  return [...cameras].sort((a, b) => score(a) - score(b) || a.code.localeCompare(b.code));
}

/**
 * The strip's `size` tiles: pinned cameras that still exist first, in pin order, then the others in
 * `prioritise` order — so a pinned camera keeps its slot whatever incident or asset is selected.
 */
export function stripCameras(
  cameras: Camera[],
  subject: StripSubject | undefined,
  pinnedIds: readonly string[],
  size: number,
): Camera[] {
  const byId = new Map(cameras.map((c) => [c.id, c]));
  const pinned = pinnedIds.flatMap((id) => byId.get(id) ?? []);
  const rest = prioritise(
    cameras.filter((c) => !pinnedIds.includes(c.id)),
    subject,
  );
  return [...pinned, ...rest].slice(0, size);
}

/** The tiles of an incident's sheet (frame 02 / 10). */
const INCIDENT_CAMERAS = 2;

/**
 * The cameras on an incident's sheet (V2-11.3). Without an asset, or when no camera shown sees
 * it, they are the incident's zone's, in the camera list's order, as the sheet has always shown
 * them. With an asset, the cameras that see it come first, then those in the incident's zone, in the
 * strip's order (`prioritise`: an offline camera behind every online one).
 *
 * `onAsset` says that a **shown** camera sees the asset, which is what lets the sheet title the
 * section "Cameras on CT-01". A camera that sees it but is offline can be pushed out of the tiles by
 * online ones of the zone, and the title then stays the zone's rather than claim a coverage that is
 * not on screen.
 */
export function incidentCameras(
  cameras: Camera[],
  incident: Pick<Incident, 'zoneId'>,
  asset: Pick<Asset, 'position'> | undefined,
  limit: number = INCIDENT_CAMERAS,
): { cameras: Camera[]; onAsset: boolean } {
  const inZone = cameras.filter((camera) => camera.zoneId === incident.zoneId).slice(0, limit);
  if (asset === undefined) return { cameras: inZone, onAsset: false };
  const subject: StripSubject = {
    kind: 'asset',
    position: asset.position,
    zoneId: incident.zoneId,
  };
  const shown = prioritise(
    cameras.filter((camera) => cameraLink(camera, subject) !== null),
    subject,
  ).slice(0, limit);
  return shown.some((camera) => cameraLink(camera, subject) === 'asset')
    ? { cameras: shown, onAsset: true }
    : { cameras: inZone, onAsset: false };
}

/**
 * What the video wall's camera grid follows (V2-21.4, ADR-0020 "Settled in V2-21.1"): the incident the wall holds in
 * focus, if it is still in the list, otherwise the one the feed puts first among the active incidents (unresolved,
 * then the most severe, then the newest), otherwise nothing. The subject is that incident's zone, so its cameras come
 * first, as on the sheet of an incident; the incident itself comes back so a tile can name it.
 */
export function wallSubject(
  incidents: Incident[],
  focusedId: string | null,
): { incident: Incident; subject: StripSubject } | undefined {
  const focused = focusedId === null ? undefined : incidents.find((i) => i.id === focusedId);
  const incident = focused ?? incidents.filter(isActive).sort(compareIncidents)[0];
  if (incident === undefined) return undefined;
  return { incident, subject: { kind: 'zone', zoneId: incident.zoneId } };
}

/** Pins whose camera still exists. */
function livePins(pinned: readonly string[], knownIds: readonly string[]): string[] {
  return pinned.filter((id) => knownIds.includes(id));
}

/**
 * Pins `id`, or unpins it when it is pinned. Ids missing from `knownIds` are dropped first: a
 * reseeded database gives every camera a new id, and stale pins must not keep the strip full.
 * Pinning past `PIN_LIMIT` leaves the list unchanged.
 */
export function togglePinned(
  pinned: readonly string[],
  id: string,
  knownIds: readonly string[],
): string[] {
  const live = livePins(pinned, knownIds);
  if (live.includes(id)) return live.filter((p) => p !== id);
  return live.length < PIN_LIMIT ? [...live, id] : live;
}

/** Whether `id` can be toggled: it is pinned (so it can be unpinned), or there is room for a pin. */
export function canPin(
  pinned: readonly string[],
  id: string,
  knownIds: readonly string[],
): boolean {
  const live = livePins(pinned, knownIds);
  return live.includes(id) || live.length < PIN_LIMIT;
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
