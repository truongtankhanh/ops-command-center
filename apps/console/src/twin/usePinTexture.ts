import { useEffect, useState } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { atlasLayout } from '../lib/twinMarkers';
import { PIN_BELOW_TIP_PX, PIN_SIZE_PX } from '../lib/twinPin';
import { mapColors } from '../styles/tokens';
import type { SpriteAtlas } from './useMarkerAtlas';

/** The id of the pin's one cell in its atlas. */
export const PIN_CELL_ID = 'report-pin';

/**
 * Frame 03's and 09's pin: the 2D map's `PIN_SVG` path (`CampusMap`), a teardrop whose tip is the origin, in the same
 * 24 × 34 box (`viewBox="-12 -31 24 34"`).
 */
const PIN_PATH = 'M0 0 C-3 -7 -10 -11 -10 -19 A10 10 0 1 1 10 -19 C10 -11 3 -7 0 0 Z';
/** The tip's place in the box: 12 px from the left and 31 from the top, so 3 px of shadow remain below it. */
const TIP_X = PIN_SIZE_PX.width / 2;
const TIP_Y = PIN_SIZE_PX.height - PIN_BELOW_TIP_PX;

/**
 * Draws the pin into a texture of its own: the shadow (the dimming colour of the dialog scrim, which is the ground's
 * colour at 60 %), the accent body with a ground-coloured edge, and the dark centre, as the 2D marker's CSS
 * (`.pinShadow`, `.pinBody`, `.pinDot`) paints them. Drawn at the device pixel ratio so it stays sharp at its fixed
 * CSS size. `null` where the browser cannot draw a canvas: the 2D map and the form's position text still show the pin.
 */
function drawPin(): SpriteAtlas | null {
  const ratio = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
  const layout = atlasLayout(
    [{ id: PIN_CELL_ID, width: PIN_SIZE_PX.width * ratio, height: PIN_SIZE_PX.height * ratio }],
    1,
  );
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;

  context.scale(ratio, ratio);
  context.translate(TIP_X, TIP_Y);

  context.save();
  context.globalAlpha = 0.6;
  context.fillStyle = mapColors.ground;
  context.beginPath();
  context.ellipse(0, 0, 7, 2.5, 0, 0, 2 * Math.PI);
  context.fill();
  context.restore();

  const body = new Path2D(PIN_PATH);
  context.fillStyle = mapColors.accent;
  context.fill(body);
  context.lineWidth = 2;
  context.strokeStyle = mapColors.ground;
  context.stroke(body);

  context.fillStyle = mapColors.ground;
  context.beginPath();
  context.arc(0, -19, 4, 0, 2 * Math.PI);
  context.fill();

  const texture = new CanvasTexture(canvas);
  // sRGB, sampled at its own size: a mip chain would only blur it (as the camera markers' atlas).
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return { texture, layout, ratio };
}

/**
 * The report pin's texture (V2-16.7), drawn once when the stage mounts and disposed with it. It needs no model, no
 * font and no request, so it is there before the first frame that wants it.
 */
export function usePinTexture(): SpriteAtlas | null {
  const [atlas] = useState(drawPin);
  useEffect(() => () => atlas?.texture.dispose(), [atlas]);
  return atlas;
}
