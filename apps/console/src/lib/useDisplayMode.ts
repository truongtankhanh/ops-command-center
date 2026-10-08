import { useSyncExternalStore } from 'react';
import { breakpoints } from '../styles/tokens';

/** The console's layouts by screen width; `breakpoints` in `styles/tokens.ts` describes each. */
export type DisplayMode = 'phone' | 'tablet' | 'laptop' | 'wall' | 'wall-4k';

/** Most specific first: a 4K wall also matches `wall`, a phone also matches `tablet`. */
const QUERIES: readonly (readonly [DisplayMode, string])[] = [
  ['wall-4k', `(min-width: ${breakpoints.wall4k}px)`],
  ['wall', `(min-width: ${breakpoints.wall}px)`],
  ['phone', `(max-width: ${breakpoints.phone}px)`],
  ['tablet', `(max-width: ${breakpoints.tablet}px)`],
];

// `matchMedia` is missing in jsdom; without it the console lays out as on a laptop.
function subscribe(onChange: () => void): () => void {
  const lists = QUERIES.flatMap(([, query]) => window.matchMedia?.(query) ?? []);
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

const getSnapshot = (): DisplayMode =>
  QUERIES.find(([, query]) => window.matchMedia?.(query).matches)?.[0] ?? 'laptop';

/**
 * The display mode for the current width, kept current when the window crosses a breakpoint (not on
 * every resize). For layout decided in script, such as how many tiles the camera strip holds; sizes
 * follow the same breakpoints in CSS (`--ui-scale` in tokens.css).
 */
export function useDisplayMode(): DisplayMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'laptop');
}
