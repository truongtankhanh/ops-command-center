import type { LngLat, Zone } from '@occ/contracts';
import { isInRing } from './map/geo';
import { footprintRing } from './map/sitePlan';
import type { Vec3 } from './twinCamera';
import type { ScreenPoint } from './twinPicking';
import { type Frame, heightOf } from './twinScene';

/*
 * The report's pin in the 3D scene (V2-16.7, ADR-0020 "Settled in V2-16.7"): where it stands and where on the screen
 * it can be grabbed, as plain data. No `three`, no store and no DOM, so the rules are tested without WebGL.
 * `twin/ReportPin.tsx` draws it and `twin/picker.ts` tests it in screen space.
 */

/** The pin's sprite in CSS pixels (frame 09's drop: 24 wide, 34 high with its shadow), also its grab target: at least the 24 px of WCAG 2.5.8. */
export const PIN_SIZE_PX = { width: 24, height: 34 } as const;

/** The drawing reaches this far below the tip (the shadow), as the 2D marker's `PIN_TIP_OFFSET`. */
export const PIN_BELOW_TIP_PX = 3;

/**
 * Where the pin stands in scene metres (`x` east, `y` up, `z` = −north): the position through the frame, at the roof's
 * height when it lies inside a building's footprint (the ring the beacons and the shells use, so an incident reported
 * here stands where the pin does), else on the ground. The height is derived from the position and not stored, so a pin
 * set by a click, a drag, the zone select or a preset stands by one rule. A building in focus is see-through
 * (`focusZoneId`), so a pin inside it stands on its floor, not on a roof that is not drawn.
 */
export function pinScenePosition(
  position: LngLat,
  zones: readonly Zone[],
  frame: Frame,
  focusZoneId: string | null,
): Vec3 {
  const [x, z] = frame.toLocal(position);
  for (const zone of zones) {
    if (zone.kind !== 'building') continue;
    const ring = footprintRing(zone);
    if (ring === null || !isInRing(position, ring)) continue;
    return [x, zone.id === focusZoneId ? 0 : heightOf(zone), z];
  }
  return [x, 0, z];
}

/**
 * Whether `point` is on the pin whose tip is at `tip` on the screen (CSS pixels from the canvas's top-left corner):
 * the sprite's rectangle, standing on the tip with the shadow below it. `null` for a pin that is not on the screen
 * (behind the camera), which is never hit.
 */
export function pinHits(point: ScreenPoint, tip: ScreenPoint | null): boolean {
  if (tip === null) return false;
  const dx = Math.abs(point.x - tip.x);
  const above = tip.y - point.y;
  return (
    dx <= PIN_SIZE_PX.width / 2 &&
    above <= PIN_SIZE_PX.height - PIN_BELOW_TIP_PX &&
    above >= -PIN_BELOW_TIP_PX
  );
}
