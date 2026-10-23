import type { TwinCapability } from './twinCapability';

/** What the map stage draws: the MapLibre site plan, or the three.js twin (V2-12). */
export type ViewChoice = '2d' | '3d';

const STORAGE_KEY = 'occ.console.view';

/**
 * The view the operator chose in this browser, or `null` when none was made. Only an explicit
 * choice is stored, so the default can follow the device's capability (ADR-0020, "Default view"),
 * and a missing, unknown or unavailable storage gives `null` too.
 */
export function readViewChoice(): ViewChoice | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === '2d' || stored === '3d' ? stored : null;
  } catch {
    return null;
  }
}

export function writeViewChoice(choice: ViewChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not remembered: the choice still holds until the page reloads.
  }
}

/**
 * The view that is drawn: 3D only where the device can, whatever was stored (a `3d` kept by a later
 * build reads as `2d` here and is left as it is in storage), and with no choice the default is 3D
 * where it is available.
 */
export function effectiveView(choice: ViewChoice | null, capability: TwinCapability): ViewChoice {
  if (!capability.available) return '2d';
  return choice ?? '3d';
}
