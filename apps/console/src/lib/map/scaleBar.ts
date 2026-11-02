import { metresToPixels } from './geo';

/*
 * The scale bar's arithmetic (V3-10.3), shared by the 2D map and the 3D stage. Pure: no map, no canvas, no DOM,
 * so the ladder of lengths is tested without either.
 *
 * The bar shows a round length, 1 / 2 / 5 × 10ⁿ metres: the same ladder a printed map uses, and the one whose
 * neighbours are never more than 2.5× apart, so the bar is always between `maxPx / 2.5` and `maxPx` wide.
 */

/**
 * The widest the bar is drawn, in CSS px (frame 01's `.scalebar .bar`). **Plain px, never `--ui-scale`d:** the bar is
 * a measurement of the same CSS pixels MapLibre's tiles and the camera's viewport are in, so scaling it would make
 * the label wrong wherever the scale is not 1.
 */
export const SCALE_BAR_MAX_PX = 120;

/** The mantissas of the ladder, widest first. */
const LADDER = [5, 2, 1] as const;

/** Floating-point slack when a length is compared with the room it has (`log10` and `10 ** n` are not exact). */
const EPSILON = 1e-9;

export interface NiceLength {
  /** The round length, in metres. */
  metres: number;
  /** How wide it is on screen, in CSS px: at most the `maxPx` it was asked to fit. */
  px: number;
}

/**
 * The largest round length (1 / 2 / 5 × 10ⁿ m) that fits `maxPx` at `metresPerPixel`, and its width in px. `null` when
 * there is no scale to draw: a `metresPerPixel` or `maxPx` that is not a positive finite number (a map at the pole, a
 * canvas not laid out yet, `Infinity` from `metresPerPixelAt`).
 */
export function niceLength(metresPerPixel: number, maxPx: number): NiceLength | null {
  if (![metresPerPixel, maxPx].every((value) => Number.isFinite(value) && value > 0)) return null;
  const room = metresPerPixel * maxPx;
  const exponent = Math.floor(Math.log10(room));
  // `exponent - 1` only matters when `log10` rounded up across a power of ten; the loop then falls through to it.
  for (const power of [exponent, exponent - 1]) {
    for (const mantissa of LADDER) {
      const metres = Number((mantissa * 10 ** power).toPrecision(12));
      if (metres <= room * (1 + EPSILON)) return { metres, px: metres / metresPerPixel };
    }
  }
  return null;
}

/**
 * "50 cm" below a metre, "50 m", "1 km" from a thousand metres; "≈ " in front when the figure is an approximation
 * (the 3D view: a perspective picture has no one scale). Centimetres, not "0.5 m": the 3D view of an asset comes
 * within 4 m of its target, where 120 px is under a metre.
 */
export function formatLength(metres: number, approximate = false): string {
  const text =
    metres < 1
      ? `${Math.round(metres * 100)} cm`
      : metres >= 1000
        ? `${Number((metres / 1000).toPrecision(12))} km`
        : `${Number(metres.toPrecision(12))} m`;
  return approximate ? `≈ ${text}` : text;
}

/** What the bar shows: the label and how wide it is drawn, in CSS px. Structurally `ui/writeScale`'s `ScaleReading`. */
export interface ScaleReading {
  label: string;
  widthPx: number;
}

/** The one call both views make: the round length for this scale as a label and a width, or `null` for no bar. */
export function scaleReading(
  metresPerPixel: number,
  { approximate = false }: { approximate?: boolean } = {},
): ScaleReading | null {
  const nice = niceLength(metresPerPixel, SCALE_BAR_MAX_PX);
  return nice ? { label: formatLength(nice.metres, approximate), widthPx: nice.px } : null;
}

/**
 * Metres on the ground per CSS pixel of the 2D map at `zoom` and latitude `lat`: the inverse of `metresToPixels`, which is
 * MapLibre's own Web Mercator resolution (512 px tiles). Exact at `lat`; over a campus the latitude barely moves.
 */
export const mapMetresPerPixel = (zoom: number, lat: number): number =>
  1 / metresToPixels(1, zoom, lat);
