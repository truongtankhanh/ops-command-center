import type { Asset, Incident, Zone } from '@occ/contracts';
import { hasFreshReading, openIncidentOf } from '../assets/assets';
import type { TelemetryState } from '../telemetry/telemetryState';
import { mixInto } from './twinMaterials';

/*
 * What the 3D view's heat reading says about a building (V2-17.2, frame 13, ADR-0020 "Settled in V2-17.1"), as
 * plain data: no `three`, no store and no clock, so it tests without WebGL. The overlay (V2-17.3), the legend
 * (V2-17.4) and the building card (`twinBuilding.ts`) all read this one module, so the colour, the label and the
 * card's "Indoor" row cannot disagree (brief § Principle 1). It draws nothing and asks for no telemetry watch: the
 * 1 Hz overview already carries `indoorTempC` for every asset (ADR-0020 "Settled in V2-14.5").
 */

/** The point a building's temperature is read from: the shared key of the air handler and the climate sensor. */
export const INDOOR_TEMP_KEY = 'indoorTempC';

/**
 * The scale's ends in °C, fixed so that two days compare and the legend's 19 · 23 · 27 °C is true of every frame.
 * 27 °C is also the air handler rule's limit, but the overlay draws no breach: a breach is an incident.
 */
export const HEAT_DOMAIN: readonly [number, number] = [19, 27];

/** A building with at least one fresh source: the mean of their readings and which assets (codes) gave them. */
export interface BuildingReading {
  tempC: number;
  sources: string[];
}

/** `'silent'`: no source is fresh, whether the building has none, a stale one or an offline one. */
export type HeatReading = BuildingReading | 'silent';

/**
 * The reading of every building in `zones`, by zone id; a zone that is not a building has no entry (it has no
 * shell and no reading), so a caller must not read a missing key as silent.
 *
 * - **Sources** are the assets of the building that have an `indoorTempC` point, whatever their class (a roof air
 *   handler measures the zone too), and are fresh by `hasFreshReading`: online and not stale on the server's clock
 *   by their own rule. A fault does not matter here, a reading is a reading. A source whose value is not a finite
 *   number yet is not a source, so one bad value cannot turn the mean into `NaN`.
 * - **The temperature** is the mean of the fresh sources' raw values, rounded only for the label. Not the maximum
 *   (one hot sensor would hide a cool building), not the first source (it lets the code order choose the number).
 * - **`sources`** are codes in ascending order, so the answer does not depend on the catalogue's order.
 */
export function buildingReadings(
  zones: readonly Pick<Zone, 'id' | 'kind'>[],
  assets: readonly Asset[],
  overview: TelemetryState['assets'],
  serverNow: number | null,
): Map<string, HeatReading> {
  const candidates = new Map<string, Asset[]>();
  for (const asset of assets) {
    if (!asset.headline.some((point) => point.key === INDOOR_TEMP_KEY)) continue;
    const inZone = candidates.get(asset.zoneId);
    if (inZone === undefined) candidates.set(asset.zoneId, [asset]);
    else inZone.push(asset);
  }

  const readings = new Map<string, HeatReading>();
  for (const zone of zones) {
    if (zone.kind !== 'building') continue;
    readings.set(zone.id, readingOf(candidates.get(zone.id) ?? [], overview, serverNow));
  }
  return readings;
}

function readingOf(
  candidates: readonly Asset[],
  overview: TelemetryState['assets'],
  serverNow: number | null,
): HeatReading {
  const fresh: { code: string; tempC: number }[] = [];
  for (const asset of candidates) {
    const entry = overview[asset.code];
    if (!hasFreshReading(asset, entry, serverNow)) continue;
    const value = entry.values[INDOOR_TEMP_KEY];
    if (typeof value === 'number' && Number.isFinite(value)) {
      fresh.push({ code: asset.code, tempC: value });
    }
  }
  if (fresh.length === 0) return 'silent';

  fresh.sort((a, b) => a.code.localeCompare(b.code));
  const sum = fresh.reduce((total, source) => total + source.tempC, 0);
  return { tempC: sum / fresh.length, sources: fresh.map((source) => source.code) };
}

/**
 * Where `tempC` sits on the scale: 0 at the domain's low end, 1 at its high end, held to 0 – 1 beyond them (the
 * colour clamps, the label does not). Never `NaN`, which would flow into a colour: a temperature that is not a
 * finite number and a domain that is empty or reversed both give 0.
 */
export function heatT(tempC: number, domain: readonly [number, number] = HEAT_DOMAIN): number {
  const [low, high] = domain;
  if (!Number.isFinite(tempC) || !(high > low)) return 0;
  return Math.min(1, Math.max(0, (tempC - low) / (high - low)));
}

/**
 * The colour (`#rrggbb`) at `t` (held to 0 – 1) on `stops`, the `--heat-*` ramp: stops sit evenly along 0 – 1 and
 * the colour is linear in sRGB between neighbours, so it is a stop's own colour exactly at the stop and continuous
 * between them. `mixInto` is the arithmetic the tokens' `color-mix` is checked with. Converting to the renderer's
 * working space is the painter's job (V2-17.3). Fewer than two stops cannot be interpolated: the first one, or
 * black for none.
 */
export function heatColor(t: number, stops: readonly string[]): string {
  const first = stops[0];
  if (first === undefined) return '#000000';
  if (stops.length < 2) return first;

  const x = (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(x));
  const from = stops[index];
  const to = stops[index + 1];
  if (from === undefined || to === undefined) return first;
  return mixInto(from, to, x - index);
}

/** "22.0 °C": one decimal, the real number even beyond the scale. The one formatter of a building's temperature. */
export function tempText(tempC: number): string {
  return `${tempC.toFixed(1)} °C`;
}

/** What the overlay writes beside a building: its temperature, or "No data" for a silent one. */
export function heatLabel(reading: HeatReading): string {
  return reading === 'silent' ? 'No data' : tempText(reading.tempC);
}

/**
 * The levels at which the overlay is drawn: the campus and a building in focus. It is defined in `twinLevel.ts`
 * (V2-17.4: the main-chunk picker asks it too) and re-exported here, where the overlay's readers import it.
 */
export { showsHeat } from './twinLevel';

/**
 * The whole overlay as data (V2-17.3), built once per change of reading and read by everything that draws a part of
 * it: the shells and the equipment in the canvas, the labels and the 3D view's name. `null` stands for "not shown"
 * wherever it is passed, so each reader does nothing without it.
 */
export interface HeatScene {
  /** `#rrggbb` per building with a reading, by zone id: the ramp at its temperature. A silent building has none. */
  colours: ReadonlyMap<string, string>;
  /** The zones of the buildings with no fresh source: faded at campus level. */
  silent: ReadonlySet<string>;
  /** The line under each building's name, by zone id: "22.0 °C", or "No data". */
  labels: ReadonlyMap<string, string>;
  /** The names of the silent buildings, in the zones' order, for the 3D view's name. */
  silentNames: readonly string[];
  /** The codes of the assets with an open incident of their own: they are not ghosted, whatever else is. */
  alarmed: ReadonlySet<string>;
  /**
   * Changes when, and only when, something above does. The readings are recomputed every second (the clock ticks), so
   * an identity of their own would repaint a quiet scene and wake the on-demand canvas for nothing; a caller keeps the
   * previous scene while the key is equal.
   */
  key: string;
}

interface HeatSceneInput {
  zones: readonly Pick<Zone, 'id' | 'name'>[];
  readings: ReadonlyMap<string, HeatReading>;
  assets: readonly Pick<Asset, 'id' | 'code'>[];
  incidents: readonly Incident[];
  /** The ramp, `twinColors.heat`: a parameter, so this module imports no token file. */
  stops: readonly string[];
}

/**
 * The overlay for `readings` (`buildingReadings`): the colour and the label of every building, which are silent, and
 * which assets are in alarm. The alarm is the feed's own rule (`openIncidentOf`: an unresolved incident whose
 * `assetId` is the asset), so the ghost lifts exactly where the severity tint shows.
 */
export function heatSceneOf({
  zones,
  readings,
  assets,
  incidents,
  stops,
}: HeatSceneInput): HeatScene {
  const colours = new Map<string, string>();
  const labels = new Map<string, string>();
  const silent = new Set<string>();
  for (const [zoneId, reading] of readings) {
    labels.set(zoneId, heatLabel(reading));
    if (reading === 'silent') silent.add(zoneId);
    else colours.set(zoneId, heatColor(heatT(reading.tempC), stops));
  }
  const silentNames = zones.filter(({ id }) => silent.has(id)).map(({ name }) => name);
  const alarmed = new Set(
    assets
      .filter((asset) => openIncidentOf(asset, incidents) !== undefined)
      .map(({ code }) => code),
  );

  const key = [
    [...colours].map(([zoneId, colour]) => `${zoneId}=${colour}`).join(','),
    [...labels].map(([zoneId, label]) => `${zoneId}=${label}`).join(','),
    [...silent].join(','),
    silentNames.join(','),
    [...alarmed].sort().join(','),
  ].join('|');
  return { colours, silent, labels, silentNames, alarmed, key };
}
