import { useEffect, useRef, useState } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { imageIdOf, MARKER_BOX, renderMarkerImages } from '../lib/mapImages';
import { packCells } from '../lib/twinAtlas';
import {
  type CellSpec,
  DISC_CENTRE_PX,
  ELLIPSE,
  PILL,
  PULSE_RING,
  RING_GAP_PX,
  RING_STROKE_PX,
  STEM_WIDTH_PX,
} from '../lib/twinBeaconSprites';
import type { AtlasCell, AtlasLayout, SpriteSize } from '../lib/twinMarkers';
import { mapColors } from '../styles/tokens';
import type { SpriteAtlas } from './useMarkerAtlas';

/** The widest the atlas grows, in device pixels: a few shelves hold every form the demo can draw, far under any GPU's limit. */
const MAX_ATLAS_WIDTH = 2048;

const EMPTY_LAYOUT: AtlasLayout = { width: 0, height: 0, cells: [] };

/** The atlas with the canvas it was drawn on, which the next growth copies into a larger one. */
interface Built {
  atlas: SpriteAtlas;
  canvas: HTMLCanvasElement;
}

/** The pill's face may not be loaded yet, and a canvas silently draws the fallback font if it is not. */
async function loadPillFont(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await document.fonts.load(PILL.font);
  } catch {
    // The fallback font draws a pill that is a little wider or narrower: the pill is not lost.
  }
}

/** A rounded rectangle path; a browser without `roundRect` gets square corners. */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, 4);
  else ctx.rect(x, y, w, h);
}

/**
 * Draws one cell in CSS pixels (the context is translated to the cell and scaled by the atlas's ratio), after the
 * frames' beacons (`TwinScene.dc.html`): the base is the ground ellipse, the 2 px stem and the map's marker bitmap;
 * the rings are strokes of the accent and of the critical hue; the pill is `surface3` with an accent outline.
 */
function drawCell(
  ctx: CanvasRenderingContext2D,
  cell: AtlasCell,
  spec: CellSpec,
  ratio: number,
  images: ReadonlyMap<string, HTMLImageElement>,
): void {
  const width = cell.width / ratio;
  const height = cell.height / ratio;
  ctx.save();
  ctx.translate(cell.x, cell.y);
  ctx.scale(ratio, ratio);
  switch (spec.kind) {
    case 'base': {
      const centreX = width / 2;
      const footY = height - ELLIPSE.ry;
      const discY = height - DISC_CENTRE_PX;
      ctx.globalAlpha = ELLIPSE.alpha;
      ctx.fillStyle = spec.hue;
      ctx.beginPath();
      ctx.ellipse(centreX, footY, ELLIPSE.rx, ELLIPSE.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = spec.hue;
      ctx.lineWidth = STEM_WIDTH_PX;
      ctx.beginPath();
      ctx.moveTo(centreX, footY);
      ctx.lineTo(centreX, discY);
      ctx.stroke();
      const image = images.get(imageIdOf(spec.form));
      if (image !== undefined) {
        ctx.drawImage(image, 0, discY - MARKER_BOX / 2, MARKER_BOX, MARKER_BOX);
      }
      break;
    }
    case 'ring':
      ctx.strokeStyle = mapColors.accent;
      ctx.lineWidth = RING_STROKE_PX;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, spec.radius + RING_GAP_PX, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'pulse':
      ctx.strokeStyle = spec.hue;
      ctx.lineWidth = PULSE_RING.stroke;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, spec.radius, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'pill':
      roundedRect(ctx, 0.5, 0.5, width - 1, height - 1);
      ctx.fillStyle = mapColors.surface3;
      ctx.fill();
      ctx.strokeStyle = mapColors.accent;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = PILL.font;
      ctx.fillStyle = mapColors.textPrimary;
      ctx.textAlign = 'left';
      ctx.fillText(spec.text, PILL.padding, 13);
      break;
  }
  ctx.restore();
}

/**
 * Adds `missing` to `previous` and returns the grown atlas, or `previous` when nothing could be added, or `null`
 * when the browser cannot draw (no 2D context, a bitmap that does not decode). Only the forms that are new are
 * rasterised (`renderMarkerImages` is a React render of glyphs per call); the old cells are copied from the old
 * canvas into the new one, so they are not drawn again and do not move (`packCells`). The cells' sizes are in
 * device pixels at the ratio the atlas started with, whatever the ratio of a later rasterisation.
 */
async function grow(missing: readonly CellSpec[], previous: Built | null): Promise<Built | null> {
  const forms = missing.flatMap((cell) => (cell.kind === 'base' ? [cell.form] : []));
  const rendered = forms.length > 0 ? await renderMarkerImages(forms) : null;
  const images = new Map(rendered?.images ?? []);
  const ratio = previous?.atlas.ratio ?? rendered?.ratio ?? 1;

  if (missing.some((cell) => cell.kind === 'pill')) await loadPillFont();
  const measuring = document.createElement('canvas').getContext('2d');
  if (measuring === null) return previous;
  measuring.font = PILL.font;

  const sizes = missing.map((cell): SpriteSize => {
    const css =
      cell.kind === 'pill'
        ? { width: measuring.measureText(cell.text).width + 2 * PILL.padding, height: cell.height }
        : cell;
    return {
      id: cell.id,
      width: Math.ceil(css.width * ratio),
      height: Math.ceil(css.height * ratio),
    };
  });
  const packed = packCells(previous?.atlas.layout ?? EMPTY_LAYOUT, sizes, {
    maxWidth: MAX_ATLAS_WIDTH,
  });
  if (packed.added.length === 0) return previous;

  const canvas = document.createElement('canvas');
  canvas.width = packed.layout.width;
  canvas.height = packed.layout.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return previous;
  if (previous !== null) ctx.drawImage(previous.canvas, 0, 0);
  const specs = new Map(missing.map((cell) => [cell.id, cell]));
  for (const cell of packed.added) {
    const spec = specs.get(cell.id);
    if (spec !== undefined) drawCell(ctx, cell, spec, ratio, images);
  }

  const texture = new CanvasTexture(canvas);
  // The bitmaps are sRGB. Sampled at 1 – 1.5× their size, so a mip chain would only blur them.
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  return { atlas: { texture, layout: packed.layout, ratio }, canvas };
}

/**
 * The beacons' atlas (V2-16.3): it holds `cells` and **grows** as the set changes, where `useMarkerAtlas` draws a
 * fixed list once. `null` until the first bitmaps have decoded (and for good if the browser cannot draw them: the 2D
 * map and the feed still show every incident). The object it returns changes only when a cell was added, so a layer
 * built on it is not rebuilt for nothing; the texture it replaces is disposed, and the last one with the stage.
 * `cells` need not be stable: only cells the atlas lacks start any work.
 */
export function useBeaconAtlas(cells: readonly CellSpec[]): SpriteAtlas | null {
  const [built, setBuilt] = useState<Built | null>(null);
  // What was committed: a growth that finishes after a newer one started is discarded, never merged.
  const committed = useRef<Built | null>(null);

  useEffect(() => {
    const have = new Set(committed.current?.atlas.layout.cells.map((cell) => cell.id));
    const missing = cells.filter((cell) => !have.has(cell.id));
    if (missing.length === 0) return;
    let current = true;
    grow(missing, committed.current)
      .then((next) => {
        if (next === null || next === committed.current) return;
        if (!current) {
          next.atlas.texture.dispose();
          return;
        }
        const previous = committed.current;
        committed.current = next;
        setBuilt(next);
        previous?.atlas.texture.dispose();
      })
      .catch(() => {
        // A bitmap that does not decode leaves the stage without beacons, not without a scene.
      });
    return () => {
      current = false;
    };
  }, [cells]);

  useEffect(
    () => () => {
      committed.current?.atlas.texture.dispose();
      committed.current = null;
    },
    [],
  );

  return built?.atlas ?? null;
}
