import { useEffect } from 'react';

/**
 * How tightly the console is spaced. `compact` fits more incidents on the screen by tightening the
 * spacing tokens (`tokens.css`, `:root[data-density='compact']`); type sizes never change with it.
 */
export type Density = 'comfortable' | 'compact';

const STORAGE_KEY = 'occ.console.density';

/**
 * The density chosen in this browser. Only `compact` is stored, so the default is comfortable and
 * cleared, unavailable or unknown storage gives it back.
 */
export function readDensity(): Density {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function writeDensity(density: Density): void {
  try {
    if (density === 'compact') localStorage.setItem(STORAGE_KEY, density);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered: the choice still holds until the page reloads.
  }
}

/**
 * Applies the density to the page: `data-density="compact"` on `<html>`, so the dialogs (portalled
 * to `body`) follow it too. Removed again when the console unmounts (sign-out), so the sign-in
 * screens keep their designed spacing.
 */
export function useDensityAttribute(density: Density): void {
  useEffect(() => {
    if (density !== 'compact') return;
    const root = document.documentElement;
    root.dataset.density = density;
    return () => {
      delete root.dataset.density;
    };
  }, [density]);
}
