import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { PerspectiveCamera } from 'three';
import { viewOffset } from '../lib/twinCamera';

/**
 * How much of the stage's right side the open sheet covers, in px: the stage's `--sheet-inset`, which
 * `tokens.css` registers as a length so `getComputedStyle` returns it in px (`"440px"`), and which is `0px`
 * while no sheet is open and on a phone, where the sheet covers the whole screen. `CampusMap` reads it the
 * same way. Any element inside the stage will do: the property is inherited.
 */
export function sheetInset(element: Element): number {
  return parseFloat(getComputedStyle(element).getPropertyValue('--sheet-inset')) || 0;
}

/**
 * How much of the stage's right side the sheet **will** cover once it is open, in px: the stage's
 * `--sheet-inset-open` (`App.module.css`, registered in `tokens.css`), which is the sheet's width and `0px` on a
 * phone, where the sheet covers the whole screen. The asset's fit (V2-15.7) is asked for in the same store update
 * that opens the inspector, before the sheet is in the DOM and `sheetInset` can read it; this is where the
 * stylesheet already says it.
 */
export function sheetInsetOpen(element: Element): number {
  return parseFloat(getComputedStyle(element).getPropertyValue('--sheet-inset-open')) || 0;
}

/**
 * Keeps the view offset of the stage's camera in step with the sheet (V2-12.9): the picture is shifted left
 * by half the sheet's width, so what the camera looks at sits in the middle of the part the sheet leaves
 * visible. Only the offset changes. The camera does not move, so opening a sheet never moves the view on
 * its own (acceptance criterion 5).
 *
 * It re-applies when the canvas is resized and when the sheet opens or closes. The stage marks that with
 * `data-sheet` on its own element, which lives in the app's React root, not the canvas's: watching the
 * attribute (on every ancestor of the canvas, because it is absent while the sheet is closed) reads
 * the inset after the DOM has changed, which a store subscription inside the canvas could not promise.
 *
 * With an offset in place, a wheel zoom's pivot can be off by up to half the sheet (camera-controls assumes
 * a centred projection): `unverified`, and the cursor-zoom criterion is judged with the sheet closed.
 *
 * Frame demand: one-shot. One frame each time the view offset is applied: on mount, when the sheet's `data-sheet`
 *   attribute changes and when the canvas is resized.
 */
export function useSheetOffset(): void {
  const get = useThree((state) => state.get);
  const { width, height } = useThree((state) => state.size);

  useEffect(() => {
    const apply = () => {
      const { camera, gl, invalidate } = get();
      if (!(camera instanceof PerspectiveCamera)) return;
      const offset = viewOffset(width, height, sheetInset(gl.domElement));
      if (offset) {
        camera.setViewOffset(
          offset.fullWidth,
          offset.fullHeight,
          offset.x,
          offset.y,
          offset.width,
          offset.height,
        );
      } else {
        camera.clearViewOffset();
      }
      camera.updateProjectionMatrix();
      invalidate();
    };

    apply();
    const observer = new MutationObserver(apply);
    for (let node = get().gl.domElement.parentElement; node; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: ['data-sheet'] });
    }
    return () => observer.disconnect();
  }, [get, width, height]);
}
