/**
 * Something went wrong with the twin during this session. Only a WebGL context that was lost and did
 * not come back within 5 s (ADR-0020 § Capability check) so far; the 3D stage reports it (V2-12.11).
 */
export type TwinFault = 'context-lost';

/**
 * Why the 3D twin cannot be drawn here. A `Record` over this union (`TWIN_UNAVAILABLE_COPY`) forces
 * every reason to have its words.
 */
export type TwinUnavailableReason = 'not-built' | 'no-webgl2' | TwinFault;

export type TwinCapability =
  { available: true } | { available: false; reason: TwinUnavailableReason };

const PREVIEW_KEY = 'occ.console.twinPreview';

/**
 * The preview gate (V2-12.1, ADR-0020): the 3D view exists in the code but must not reach operators
 * before incidents are drawn in it and the frame budgets are measured. Open in `pnpm dev`
 * (`MODE === 'development'`, not `DEV`, which Vitest sets too) and, for the tab, with `?twin=1`.
 * V2-19.8 removes it. A release control, not a security control: whoever types the parameter gets
 * the unfinished stage.
 *
 * The URL opens the gate even where storage is unavailable; storage only remembers it for the tab,
 * so a later navigation without the parameter keeps working.
 */
export function previewGateOpen(): boolean {
  if (import.meta.env.MODE === 'development') return true;
  try {
    if (new URLSearchParams(location.search).get('twin') === '1') {
      try {
        sessionStorage.setItem(PREVIEW_KEY, '1');
      } catch {
        // Not remembered: the URL still opens it for this page.
      }
      return true;
    }
  } catch {
    // No `location`: not a browser page.
  }
  try {
    return sessionStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return false;
  }
}

let webgl2Probe: boolean | undefined;

/**
 * Whether a WebGL 2 context can be created, asked once. The throwaway context is released at once
 * (`WEBGL_lose_context`): browsers allow only a few live contexts per page and the video wall wants
 * one per screen. Any failure reads as "no". Never called while the gate is closed, so a production
 * build creates no context at all.
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
 * order: the preview gate is closed (`not-built`), the device has no WebGL 2 (`no-webgl2`), the
 * twin has failed in this session (`fault`). The gate comes first so nothing else is probed where
 * the twin is not offered.
 *
 * `fault` is an argument, not read from the store, because the store imports this module; React
 * code calls it through `useTwinCapability`.
 */
export function twinCapability(fault: TwinFault | null = null): TwinCapability {
  if (!previewGateOpen()) return { available: false, reason: 'not-built' };
  if (!webgl2Supported()) return { available: false, reason: 'no-webgl2' };
  if (fault !== null) return { available: false, reason: fault };
  return { available: true };
}

/**
 * What the operator is told for each reason. `no-webgl2` is frame 07's wording and is true only for
 * a device that refuses WebGL 2; while the preview gate is closed that sentence would be false, so
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
  'context-lost': {
    title: '3D view stopped working',
    detail:
      'The graphics context was lost and did not come back. The 2D map shows the same incidents, cameras and assets.',
  },
};
