/**
 * Something went wrong with the twin during this session. Only a WebGL context that was lost and did
 * not come back within 5 s (ADR-0020 § Capability check) so far; the 3D stage reports it (V2-12.11).
 */
export type TwinFault = 'context-lost';

/**
 * Why the 3D twin cannot be drawn here. A `Record` over this union (`TWIN_UNAVAILABLE_COPY`) forces
 * every reason to have its words.
 */
export type TwinUnavailableReason = 'no-webgl2' | TwinFault;

export type TwinCapability =
  { available: true } | { available: false; reason: TwinUnavailableReason };

let webgl2Probe: boolean | undefined;

/**
 * Whether a WebGL 2 context can be created, asked once per page load. The throwaway context is
 * released at once (`WEBGL_lose_context`): browsers allow only a few live contexts per page and the
 * video wall wants one per screen. Any failure reads as "no". The store asks when it is created, so
 * every page that loads the console, the sign-in screens and an operator whose stored choice is 2D
 * included, creates and releases this one context (ADR-0020 § Capability check).
 */
export function webgl2Supported(): boolean {
  if (webgl2Probe !== undefined) return webgl2Probe;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    webgl2Probe = gl !== null && gl !== undefined;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2Probe = false;
  }
  return webgl2Probe;
}

/** Forgets the answer of `webgl2Supported`. For tests, which stub `getContext` per case. */
export function forgetWebgl2Probe(): void {
  webgl2Probe = undefined;
}

/**
 * Whether the console can render the twin here (ADR-0020 § Capability check), and if not, why. In
 * order: the device has no WebGL 2 (`no-webgl2`), the twin has failed in this session (`fault`).
 *
 * `fault` is an argument, not read from the store, because the store imports this module; React
 * code calls it through `useTwinCapability`.
 */
export function twinCapability(fault: TwinFault | null = null): TwinCapability {
  if (!webgl2Supported()) return { available: false, reason: 'no-webgl2' };
  if (fault !== null) return { available: false, reason: fault };
  return { available: true };
}

/**
 * What the operator is told for each reason. `no-webgl2` is frame 07's wording and is true only for
 * a device that refuses WebGL 2.
 */
export const TWIN_UNAVAILABLE_COPY: Record<
  TwinUnavailableReason,
  { title: string; detail: string }
> = {
  'no-webgl2': {
    title: "3D view isn't available on this device",
    detail: 'WebGL 2 is off or blocked. The 2D map shows the same incidents, cameras and assets.',
  },
  'context-lost': {
    title: '3D view stopped working',
    detail:
      'The graphics context was lost and did not come back. The 2D map shows the same incidents, cameras and assets.',
  },
};
