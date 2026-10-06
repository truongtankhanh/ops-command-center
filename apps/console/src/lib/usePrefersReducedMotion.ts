import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

// `matchMedia` is missing in jsdom; without it there is no preference to follow.
function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia?.(QUERY);
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

const getSnapshot = () => window.matchMedia?.(QUERY).matches ?? false;

/**
 * Whether the user asks for reduced motion, kept current when the setting changes. For motion
 * driven from script (the map pulse); CSS animations use the media query directly.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
