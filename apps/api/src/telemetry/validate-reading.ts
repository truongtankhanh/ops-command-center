import { ASSET_STATE_POINT_KEYS, type TelemetryPoint, type TelemetryValue } from '@occ/contracts';
import type { CatalogueAsset } from '../assets/assets.service';
import type { TelemetryMessageResult } from '../metrics/telemetry.metrics';
import type { RawReading } from './telemetry-source';

/** An `at` further than this from the API's clock is replaced by the receive time (ADR-0019). */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

// A date-time, not a bare date or a number: `Date.parse` alone also reads `"1"` and `"Jan 1"`.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

/** What validation needs of one asset: its class's points by key, and which are headlines. */
export interface AssetIndex {
  /** The asset's id, for the sample writer (V2-06.9); validation does not read it. */
  readonly id: string;
  /** A `Map`, never an object: a device may send `__proto__` or `constructor` as a key. */
  readonly points: ReadonlyMap<string, TelemetryPoint>;
  /** Keys of the headline points, rank 1 then 2. */
  readonly headlineKeys: readonly string[];
  /**
   * Keys the 1 Hz overview carries: the headline keys, then the class's state point when it is not
   * one of them (V2-09.2). Kept apart from `headlineKeys`, which stays what its name says.
   */
  readonly overviewKeys: readonly string[];
}

export type CatalogueIndex = ReadonlyMap<string, AssetIndex>;

export function indexCatalogue(assets: readonly CatalogueAsset[]): CatalogueIndex {
  const index = new Map<string, AssetIndex>();
  for (const asset of assets) {
    const headlines: Array<{ key: string; rank: number }> = [];
    for (const point of asset.points) {
      if (point.headline !== null) headlines.push({ key: point.key, rank: point.headline });
    }
    const headlineKeys = headlines.sort((a, b) => a.rank - b.rank).map((headline) => headline.key);
    const points = new Map<string, TelemetryPoint>(asset.points.map((point) => [point.key, point]));
    // Matched by key alone, as the contract names it: the class's other points are only on the wire
    // while the asset is watched, so without this a list cannot say Running or Standby (V2-09.1).
    const stateKey = ASSET_STATE_POINT_KEYS.find((key) => points.has(key));
    index.set(asset.code, {
      id: asset.id,
      points,
      headlineKeys,
      overviewKeys:
        stateKey === undefined || headlineKeys.includes(stateKey)
          ? headlineKeys
          : [...headlineKeys, stateKey],
    });
  }
  return index;
}

export interface ValidatedReading {
  result: TelemetryMessageResult;
  /** ISO. The device's `at`, normalised; the receive time when it was absent, skewed or unreadable. */
  at: string;
  /** The values that passed, never clamped. Empty when none did. */
  values: Record<string, TelemetryValue>;
  /** Keys of a known asset that are not points of its class. */
  unknownKeys: readonly string[];
}

/**
 * Checks one reading against the catalogue (ADR-0019, "Validation in the bridge"). Pure: the clock
 * is `nowMs`, and counting, logging and storing are the caller's.
 *
 * The reading has one result, by precedence `unknown_asset` > `invalid` > `clock_skew` >
 * `accepted`. A reading with a dropped value is `invalid`, but the values that passed are still
 * returned: one bad point must not blind the asset's other points.
 */
export function validateReading(
  index: CatalogueIndex,
  raw: RawReading,
  nowMs: number,
): ValidatedReading {
  const receivedAt = new Date(nowMs).toISOString();
  // The source's payload is not trusted to match the port's types (an MQTT payload is JSON).
  const asset = typeof raw.assetCode === 'string' ? index.get(raw.assetCode) : undefined;
  if (!asset) return { result: 'unknown_asset', at: receivedAt, values: {}, unknownKeys: [] };

  const entries = isPlainObject(raw.values) ? Object.entries(raw.values) : [];
  const values: Record<string, TelemetryValue> = {};
  const unknownKeys: string[] = [];
  let dropped = entries.length === 0;

  for (const [key, value] of entries) {
    const point = asset.points.get(key);
    if (!point) {
      unknownKeys.push(key);
      dropped = true;
    } else if (isValid(point, value)) {
      values[key] = value;
    } else {
      dropped = true;
    }
  }

  const { at, skewed } = resolveAt(raw.at, nowMs);
  const result = dropped ? 'invalid' : skewed ? 'clock_skew' : 'accepted';
  return { result, at, values, unknownKeys };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Kind, then range or enum membership. `min` and `max` are inclusive; `null` is no bound. */
function isValid(point: TelemetryPoint, value: unknown): value is TelemetryValue {
  switch (point.kind) {
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (point.min === null || value >= point.min) &&
        (point.max === null || value <= point.max)
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && (point.enumValues?.includes(value) ?? false);
  }
}

/**
 * Absent `at` is the receive time and is not a fault: a source may not know when the device
 * measured. A present `at` that is unreadable or too far off is replaced and flagged: the device's
 * clock is wrong, but its values are still good.
 */
function resolveAt(at: unknown, nowMs: number): { at: string; skewed: boolean } {
  if (at === undefined) return { at: new Date(nowMs).toISOString(), skewed: false };
  if (typeof at === 'string' && ISO_DATE_TIME.test(at)) {
    const measuredMs = Date.parse(at);
    if (Number.isFinite(measuredMs) && Math.abs(measuredMs - nowMs) <= MAX_CLOCK_SKEW_MS) {
      return { at: new Date(measuredMs).toISOString(), skewed: false };
    }
  }
  return { at: new Date(nowMs).toISOString(), skewed: true };
}
