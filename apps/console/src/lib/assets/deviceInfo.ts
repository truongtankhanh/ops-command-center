import type { AssetDetail, Zone } from '@occ/contracts';
import type { AssetTelemetryState } from '../telemetry/telemetryState';
import { inspectorStateText } from './assetInspector';
import { type AssetState, placeLabel } from './assets';
import { formatReading } from './readings';

/*
 * The rows of the device information card (V3-09.2; frames 02 and 04): which facts the card states
 * about a device and in what order. Pure: no store, no clock, no React. The card draws them
 * (V3-09.3).
 */

/**
 * The point that carries a device's battery. Today only the leak sensor has it (asset-classes.md,
 * hourly). The card has a battery row when the class has this point, not when the class is one
 * the console knows by name: a new class with the point gets the row.
 */
export const BATTERY_KEY = 'batteryPct';

/**
 * A text row (`value`), the status (the card draws the pill from `state`, with its glyph; `text` is
 * the bare word) or the battery (`percent` is the reading as it came, `null` while there is none;
 * clamping it to a bar's width is the card's).
 */
export type DeviceInfoRow =
  | { id: 'name' | 'code' | 'class' | 'location'; label: string; value: string }
  | { id: 'status'; label: string; state: AssetState; text: string }
  | { id: 'battery'; label: string; text: string; percent: number | null };

/**
 * The card's rows, in order: device name, device ID, class, location, status, battery.
 *
 * It states what the inputs say and never fills a gap:
 * - **location** is left out without a zone (`placeLabel` is `null`: the zones are still loading,
 *   or the zone is one this console does not have), as the head leaves out its zone chip;
 * - **status** is left out for `unknown`, a state with no word the console can stand behind
 *   (`inspectorStateText`), as the head leaves out its pill. The word has no "since": the card
 *   draws the state as the pill does;
 * - **battery** is there only for a class with a `batteryPct` point, whatever the entry holds. With
 *   the point and no reading yet it reads "—", as `AssetReadings` does for a point with no reading:
 *   an unknown battery is something to say, not a hole.
 */
export function deviceInfoRows(
  detail: Pick<AssetDetail, 'name' | 'code' | 'class' | 'points' | 'elevationM'>,
  zone: Pick<Zone, 'name' | 'kind' | 'heightM'> | undefined,
  state: AssetState,
  entry: Pick<AssetTelemetryState, 'values'> | undefined,
): DeviceInfoRow[] {
  const rows: DeviceInfoRow[] = [
    { id: 'name', label: 'Device name', value: detail.name },
    { id: 'code', label: 'Device ID', value: detail.code },
    { id: 'class', label: 'Class', value: detail.class.name },
  ];

  const location = placeLabel(detail, zone);
  if (location !== null) rows.push({ id: 'location', label: 'Location', value: location });

  const word = inspectorStateText(state, null, null);
  if (word !== null) rows.push({ id: 'status', label: 'Status', state, text: word });

  const battery = detail.points.find((point) => point.key === BATTERY_KEY);
  if (battery !== undefined) {
    const value = entry?.values[BATTERY_KEY];
    rows.push({
      id: 'battery',
      label: 'Battery',
      text: value === undefined ? '—' : formatReading(battery, value),
      percent: typeof value === 'number' && Number.isFinite(value) ? value : null,
    });
  }
  return rows;
}
