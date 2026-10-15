import {
  ASSET_STATE_POINT_KEYS,
  type Asset,
  type AssetStatePointKey,
  type TelemetryPoint,
  type TelemetryRule,
  type TelemetryValue,
} from '@occ/contracts';
import { readingWord } from './readingLabels';

/*
 * How a reading is written: its value, the line under a label, and which point says whether a
 * piece of equipment is running. Pure, so the list, the inspector and the tooltip say the same
 * thing (V2-09.3; wording settled in V2-09.1).
 */

// `en-GB` like the other formatters of the console (`Header`, `lib/time.ts`): "1,420".
const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/** "1,420 rpm", "71 °C", "86 %": at most one fraction digit, a space, then the unit if there is one. */
function measure(value: number, unit: string | null): string {
  // A device can send what the catalogue's range should have dropped; show it rather than hide it.
  if (!Number.isFinite(value)) return String(value);
  const text = NUMBER.format(value);
  // `Intl` writes a tiny negative as "-0".
  const number = text === '-0' ? '0' : text;
  return unit === null || unit === '' ? number : `${number} ${unit}`;
}

/**
 * A reading as an operator reads it. The word table first (`leakDetected` → "Wet"), then by the
 * point's kind: a number with its unit, a boolean as "Yes" / "No", an enum in sentence case. A value
 * whose type disagrees with its kind is drawn as it came: the console shows what the API sent.
 * An absent reading is the caller's to draw; this takes a value.
 */
export function formatReading(
  point: Pick<TelemetryPoint, 'key' | 'kind' | 'unit'>,
  value: TelemetryValue,
): string {
  const word = readingWord(point.key, value);
  if (word !== null) return word;
  switch (point.kind) {
    case 'number':
      return typeof value === 'number' ? measure(value, point.unit) : String(value);
    case 'boolean':
      return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
    case 'enum':
      return typeof value === 'string'
        ? value.charAt(0).toUpperCase() + value.slice(1)
        : String(value);
    default:
      // A kind from a newer API (ADR-0018: kinds are only appended).
      return String(value);
  }
}

/**
 * The line under a label: the rule that watches the point, "Limit 85 °C" or "Low at 20 %" (frame
 * 08). `null` for a boolean point, whose rule's 0.5 is an encoding (ADR-0018) and not a number an
 * operator reads, and for a comparator this console does not know.
 */
export function limitLine(
  rule: Pick<TelemetryRule, 'comparator' | 'limit'>,
  point: Pick<TelemetryPoint, 'kind' | 'unit'>,
): string | null {
  if (point.kind === 'boolean') return null;
  const limit = measure(rule.limit, point.unit);
  switch (rule.comparator) {
    case 'above':
      return `Limit ${limit}`;
    case 'below':
      return `Low at ${limit}`;
    default:
      return null;
  }
}

/**
 * Which class has which state point (asset-classes.md § State of an asset). `Asset` carries only the
 * class's headline points, and the state point is not one of them for four classes, which is why the
 * overview carries it separately (V2-09.2): the list alone cannot tell a leak sensor, which is
 * simply Running, from a cooling tower whose `running` has not arrived. Temporary, as the parts table
 * of V2-14: a catalogue field would replace it. A `Map`, so `constructor` is not a class.
 */
const STATE_POINT_BY_CLASS = new Map<string, AssetStatePointKey>([
  ['cooling_tower', 'running'],
  ['standby_generator', 'running'],
  ['precision_cooling', 'running'],
  ['chiller', 'running'],
  ['air_handler', 'running'],
  ['booster_pump', 'running'],
  ['barrier_arm', 'armPosition'],
]);

const isStatePointKey = (key: string): key is AssetStatePointKey =>
  (ASSET_STATE_POINT_KEYS as readonly string[]).includes(key);

/**
 * The point that says whether `asset` is running, or `null` when its class has none and it is
 * Running whenever nothing else is wrong. A headline point that is one wins, so a class the table
 * does not list but that sends it as a headline still works; a class unknown to both reads as
 * having none.
 */
export function statePointOf(asset: Pick<Asset, 'class' | 'headline'>): AssetStatePointKey | null {
  for (const point of asset.headline) {
    if (isStatePointKey(point.key)) return point.key;
  }
  return STATE_POINT_BY_CLASS.get(asset.class.code) ?? null;
}
