/**
 * Why the 3D twin cannot be drawn on this device. A reason is open to growth: V2-12 adds
 * `context-lost` (a WebGL context that does not restore within 5 s, ADR-0020) together with its copy,
 * which `TWIN_UNAVAILABLE_COPY` being a `Record` over this union forces.
 */
export type TwinUnavailableReason = 'not-built' | 'no-webgl2';

export type TwinCapability =
  { available: true } | { available: false; reason: TwinUnavailableReason };

/**
 * Whether the console can render the twin here (ADR-0020 § Capability check). The seam V2-12 fills
 * in: until the twin exists it is `not-built`, so the switch shows 3D as unavailable and the stage
 * draws the 2D map. V2-12 replaces this body with the WebGL 2 check; nothing that reads it changes.
 */
export function twinCapability(): TwinCapability {
  return { available: false, reason: 'not-built' };
}

/**
 * What the operator is told for each reason. `no-webgl2` is frame 07's wording and is true only for
 * a device that refuses WebGL 2; before the twin is built that sentence would be false, so
 * `not-built` says what is actually the case (Open question 3, settled 2026-10-14).
 */
export const TWIN_UNAVAILABLE_COPY: Record<
  TwinUnavailableReason,
  { title: string; detail: string }
> = {
  'not-built': {
    title: "3D view isn't available in this version",
    detail: 'The 2D map shows the same incidents, cameras and assets.',
  },
  'no-webgl2': {
    title: "3D view isn't available on this device",
    detail: 'WebGL 2 is off or blocked. The 2D map shows the same incidents, cameras and assets.',
  },
};
