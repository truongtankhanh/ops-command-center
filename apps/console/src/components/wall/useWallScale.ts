import { useLayoutEffect } from 'react';
import { wallScale } from '../../lib/wall/wallScale';

/**
 * Sets `--ui-scale` on `<html>` from the window's width while the video wall is mounted (V2-21.3), over the console's
 * own scale in `tokens.css`, which an inline style beats. Set before the first paint, kept in step as the window
 * changes (the factor moves in steps, so most resizes set the value it already has), and taken away on unmount.
 */
export function useWallScale(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => root.style.setProperty('--ui-scale', String(wallScale(window.innerWidth)));
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      root.style.removeProperty('--ui-scale');
    };
  }, []);
}
