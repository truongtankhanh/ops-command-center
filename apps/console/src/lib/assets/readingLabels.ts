import type { TelemetryValue } from '@occ/contracts';

/**
 * The words for a reading's value, by point `key` (asset-classes.md § Words for values, settled in
 * V2-09.1). The catalogue carries a `label` and a `unit` per point and no word per value, so these
 * live in the console until a site needs its own, when a follow-up may move them into the catalogue.
 *
 * Only the keys the design names are here. Any other value is formatted by its kind in
 * `formatReading`, so a point or a value that a newer API sends first still renders.
 */

const booleanWords =
  (whenTrue: string, whenFalse: string) =>
  (value: TelemetryValue): string | null =>
    typeof value === 'boolean' ? (value ? whenTrue : whenFalse) : null;

const enumWords =
  (words: Readonly<Record<string, string>>) =>
  (value: TelemetryValue): string | null =>
    typeof value === 'string'
      ? Object.hasOwn(words, value)
        ? (words[value] ?? null)
        : null
      : null;

// A `Map`, so a point key such as `constructor` is never read off the object prototype.
const WORDS = new Map<string, (value: TelemetryValue) => string | null>([
  ['leakDetected', booleanWords('Wet', 'Dry')],
  ['inService', booleanWords('In service', 'Out of service')],
  ['running', booleanWords('Running', 'Stopped')],
  ['armPosition', enumWords({ up: 'Up', down: 'Down', moving: 'Moving' })],
  // The generator's main breaker, a part row of the inspector (V2-09.9): "Yes" would answer a
  // question nobody asked.
  ['breakerClosed', booleanWords('Closed', 'Open')],
  [
    'carFloor',
    (value) => (typeof value === 'number' && Number.isFinite(value) ? `Floor ${value}` : null),
  ],
]);

/** The word for `value` of the point `key`, or `null` when this table has none (never a guess). */
export function readingWord(key: string, value: TelemetryValue): string | null {
  return WORDS.get(key)?.(value) ?? null;
}
