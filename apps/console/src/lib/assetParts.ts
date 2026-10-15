import type { TelemetryPoint, TelemetryValue } from '@occ/contracts';
import { formatReading } from './readings';

/*
 * The parts of a modelled asset, as the inspector lists them (V2-09.9; asset-classes.md § Parts of
 * an asset, frames 03, 05, 08). TEMPORARY: a second copy of the Bound part columns of
 * asset-classes.md, until V2-14 builds the bindings from the model's glTF `extras` (ADR-0020) and
 * deletes this file. `assetParts.test.ts` keeps every bound key a point of its class.
 *
 * Only the two modelled classes are here, and a class that is not here has no Parts section
 * (frame 15). `role` is the model's node name, which is an interface (a rename is a breaking
 * change to the model), so it is spelled as the node is.
 */

export interface PartSpec {
  /** The node's name in the model: `FanBlade`. Unique within a class. */
  role: string;
  /** What the operator reads. */
  label: string;
  /** The `key` of the point the part shows; `null` for a part that binds nothing (static). */
  bind: string | null;
  /** The `role` of the part this one sits under, or `null` for a top-level part. */
  parent: string | null;
}

const part = (
  role: string,
  label: string,
  bind: string | null = null,
  parent: string | null = null,
): PartSpec => ({ role, label, bind, parent });

// In the order the frames draw them, children straight after their parent. Static parts are the
// ones a frame draws: `Pipe` and `Riser` are in the brief's tree but in no frame (Q1).
// `ControlPanel` binds nothing on the tower and `controlMode` on the generator.
const PARTS = new Map<string, readonly PartSpec[]>([
  [
    'cooling_tower',
    [
      part('Casing', 'Casing'),
      part('FanStack', 'Fan stack'),
      part('FanBlade', 'Fan blade', 'fanSpeedRpm', 'FanStack'),
      part('FanMotor', 'Fan motor', 'motorTempC'),
      part('Pump', 'Pump', 'pumpFlowM3h'),
      part('Valve', 'Valve', 'valveOpenPct'),
      part('ControlPanel', 'Control panel'),
      part('Switch', 'Switch', 'switchState', 'ControlPanel'),
    ],
  ],
  [
    'standby_generator',
    [
      part('Enclosure', 'Enclosure'),
      part('Engine', 'Engine', 'coolantTempC'),
      part('Alternator', 'Alternator', 'alternatorKw'),
      part('RadiatorFan', 'Radiator', 'engineSpeedRpm'),
      part('FuelTank', 'Fuel tank', 'fuelLevelPct'),
      part('Battery', 'Starter battery', 'starterBatteryV'),
      part('ControlPanel', 'Control panel', 'controlMode'),
      part('Breaker', 'Breaker', 'breakerClosed', 'ControlPanel'),
    ],
  ],
]);

/** The parts of a class, or `undefined` for a class this console has no part table for. */
export function partsOf(classCode: string): readonly PartSpec[] | undefined {
  return PARTS.get(classCode);
}

/** Whether another part of the same list sits under `spec`: it is drawn open, with a chevron. */
export function hasChildren(spec: PartSpec, parts: readonly PartSpec[]): boolean {
  return parts.some((other) => other.parent === spec.role);
}

/**
 * What a part row says: "static" for a part that binds nothing, "—" for a bound one with no
 * reading yet, else the reading as the readings rows write it. While the asset is not live the
 * reading reads "last 1,420 rpm" (frame 05), so a remembered value is never taken for a live one.
 */
export function partText(
  spec: Pick<PartSpec, 'bind'>,
  point: TelemetryPoint | undefined,
  value: TelemetryValue | undefined,
  stale: boolean,
): string {
  if (spec.bind === null) return 'static';
  if (point === undefined || value === undefined) return '—';
  const text = formatReading(point, value);
  return stale ? `last ${text}` : text;
}
