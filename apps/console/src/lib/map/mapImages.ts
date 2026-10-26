import { INCIDENT_SEVERITIES, INCIDENT_TYPES, type IncidentSeverity } from '@occ/contracts';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { canvasFont, mapColors } from '../../styles/tokens';
import {
  cameraIcon,
  type Glyph,
  incidentTypeIcon,
  severityIcon,
  unknownIcon,
} from '../../ui/icons';
import {
  assetImageId,
  cameraImageId,
  CLUSTER_COUNT_PREFIX,
  clusterSeverityImageId,
  incidentImageId,
  type MarkerType,
  resolvedImageId,
  UNKNOWN_TYPE_IMAGE,
} from './mapFeatures';

/*
 * The map's marker images, drawn from the same glyphs as the rest of the console (docs/design/icons.md,
 * "Map glyphs"). Each marker form is one pre-composed image — disc and glyph together — so a
 * single symbol layer can order overlapping markers correctly, and glyphs stay crisp at 12–14 px.
 * Geometry follows frames 01, 02 and 04 (`.mk-*`, `.pl-cam` in docs/design/mockups/console.css).
 */

export type MarkerForm =
  | {
      kind: 'incident';
      severity: IncidentSeverity;
      status: 'open' | 'acknowledged';
      type: MarkerType;
    }
  | { kind: 'resolved'; type: MarkerType }
  | { kind: 'camera'; online: boolean }
  | { kind: 'cluster-severity'; severity: IncidentSeverity }
  // A diamond with no glyph (frame 14 `.pl-asset`); a fault takes its incident's severity.
  | { kind: 'asset'; look: 'normal' | 'nodata' }
  | { kind: 'asset'; look: 'fault'; severity: IncidentSeverity };

/** A form that carries a glyph; the asset diamond does not. */
type GlyphForm = Exclude<MarkerForm, { kind: 'asset' }>;

/** Incident images are drawn in a square of this many CSS px, centred on the feature. */
export const MARKER_BOX = 28;
const CAMERA_BOX = 14;
/** The asset diamond: 8 px square turned 45° (11.3 px across) plus its 1.5 px stroke. */
const ASSET_BOX = 14;
const ASSET_SIDE = 8;
const ASSET_STROKE = 1.5;
/** Frame 14 `.is-fault`: the severity at 30 % over the asset's surface. */
const ASSET_FAULT_TINT = 0.3;
/** The cluster's severity badge: a small severity disc with its glyph, on the cluster's ring. */
const BADGE_BOX = 16;
const BADGE = { radius: 7, glyph: 10 };
const DISC_RADIUS: Record<IncidentSeverity, number> = {
  low: 10,
  medium: 10,
  high: 11,
  critical: 12,
};
const GLYPH_SIZE: Record<IncidentSeverity, number> = {
  low: 12,
  medium: 12,
  high: 13,
  critical: 14,
};
/**
 * Smaller than every severity step (10 to 12), because Low is a neutral ring now (ADR-0022) and an acknowledged Low
 * and a resolved incident are otherwise the same disc: ground fill, a 3 px ring, the type glyph.
 */
const RESOLVED = { radius: 8, glyph: 10 };

/**
 * The radius of the disc an incident marker draws, in CSS px: the severity's step for an active incident (10, 10, 11,
 * 12) and the smaller, neutral 8 for a resolved one. The 3D beacons place their rings and tags from it (V2-16.3).
 */
export const discRadiusOf = (
  form: Extract<MarkerForm, { kind: 'incident' | 'resolved' }>,
): number => (form.kind === 'resolved' ? RESOLVED.radius : DISC_RADIUS[form.severity]);

/** Cluster count labels. The canvas cannot read tokens: the family is drift-checked against `--font-ui`. */
const COUNT_FONT = canvasFont.clusterCount;
const COUNT_BOX = 28;

interface GlyphStyle {
  glyph: Glyph;
  size: number;
  color: string;
  strokeWidth: number;
}

const typeGlyph = (type: MarkerType): Glyph =>
  type === UNKNOWN_TYPE_IMAGE ? unknownIcon : incidentTypeIcon(type);

export function glyphStyle(form: GlyphForm): GlyphStyle {
  switch (form.kind) {
    case 'camera':
      return {
        glyph: cameraIcon(form.online),
        size: 8,
        strokeWidth: 2.4,
        color: form.online ? mapColors.textSecondary : mapColors.textTertiary,
      };
    case 'resolved':
      return {
        glyph: typeGlyph(form.type),
        size: RESOLVED.glyph,
        strokeWidth: 2.6,
        color: mapColors.textTertiary,
      };
    case 'incident':
      return {
        glyph: typeGlyph(form.type),
        size: GLYPH_SIZE[form.severity],
        strokeWidth: 2.6,
        // Open: on the severity disc. Acknowledged: on the ground, inside a severity ring.
        color: form.status === 'open' ? mapColors.onAccent : mapColors.severity[form.severity],
      };
    case 'cluster-severity':
      return {
        glyph: severityIcon(form.severity),
        size: BADGE.glyph,
        strokeWidth: 2.6,
        color: mapColors.onAccent,
      };
  }
}

export function imageIdOf(form: MarkerForm): string {
  switch (form.kind) {
    case 'camera':
      return cameraImageId(form.online);
    case 'resolved':
      return resolvedImageId(form.type);
    case 'incident':
      return incidentImageId(form);
    case 'cluster-severity':
      return clusterSeverityImageId(form.severity);
    case 'asset':
      return assetImageId(form.look, form.look === 'fault' ? form.severity : null);
  }
}

/**
 * The SVG for one marker form, with `glyphMarkup` (the glyph's own `<svg>`, already sized and
 * coloured by `glyphStyle`) centred on its shape. `pixelRatio` scales the bitmap, not the drawing.
 */
export function markerSvg(form: MarkerForm, glyphMarkup: string, pixelRatio: number): string {
  const box = boxOf(form);
  const centre = box / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box * pixelRatio}" height="${box * pixelRatio}" viewBox="0 0 ${box} ${box}">`,
    shapeSvg(form, centre),
    glyphSvg(form, glyphMarkup, centre),
    '</svg>',
  ].join('');
}

/** The glyph centred on the shape; the asset diamond has none, so `glyphMarkup` is not placed. */
function glyphSvg(form: MarkerForm, glyphMarkup: string, centre: number): string {
  if (form.kind === 'asset') return '';
  const at = centre - glyphStyle(form).size / 2;
  return `<g transform="translate(${at} ${at})">${glyphMarkup}</g>`;
}

function boxOf(form: MarkerForm): number {
  switch (form.kind) {
    case 'camera':
      return CAMERA_BOX;
    case 'cluster-severity':
      return BADGE_BOX;
    case 'asset':
      return ASSET_BOX;
    default:
      return MARKER_BOX;
  }
}

function shapeSvg(form: MarkerForm, centre: number): string {
  switch (form.kind) {
    case 'camera': {
      const dash = form.online ? '' : ' stroke-dasharray="2 2"';
      return `<rect x="1" y="1" width="12" height="12" rx="3" fill="${mapColors.surface1}" stroke="${mapColors.textTertiary}" stroke-width="1"${dash}/>`;
    }
    case 'resolved':
      return disc(centre, RESOLVED.radius, mapColors.ground, mapColors.textTertiary, 3);
    case 'incident': {
      const hue = mapColors.severity[form.severity];
      const radius = DISC_RADIUS[form.severity];
      return form.status === 'open'
        ? disc(centre, radius, hue, mapColors.ground, 2.5)
        : disc(centre, radius, mapColors.ground, hue, 3);
    }
    case 'cluster-severity':
      // Ground-coloured edge, like an open marker, so the badge stands off the cluster's ring.
      return disc(centre, BADGE.radius, mapColors.severity[form.severity], mapColors.ground, 1.5);
    case 'asset':
      return diamond(centre, form);
  }
}

/**
 * The asset's look is fill, edge and dash, so no colour is the only cue: normal is a light edge, a
 * fault is the incident's severity (a tint and an edge in that hue), no data is a dim dashed edge
 * (frame 14 `.is-stale`; stale is the dash, not a brighter outline).
 */
function diamond(centre: number, form: Extract<MarkerForm, { kind: 'asset' }>): string {
  const half = ASSET_SIDE / 2;
  const turn = `transform="translate(${centre} ${centre}) rotate(45)"`;
  const rect = (attributes: string) =>
    `<rect x="${-half}" y="${-half}" width="${ASSET_SIDE}" height="${ASSET_SIDE}" rx="1.5" ${turn} ${attributes}/>`;
  const edge = (colour: string, extra = '') =>
    `stroke="${colour}" stroke-width="${ASSET_STROKE}"${extra}`;
  switch (form.look) {
    case 'normal':
      return rect(`fill="${mapColors.surface2}" ${edge(mapColors.textSecondary)}`);
    case 'nodata':
      return rect(
        `fill="${mapColors.surface2}" ${edge(mapColors.staleEdge, ' stroke-dasharray="2 2"')}`,
      );
    case 'fault': {
      const hue = mapColors.severity[form.severity];
      // The tint is drawn over the surface, which `fill-opacity` cannot do on its own.
      return (
        rect(`fill="${mapColors.surface2}"`) +
        rect(`fill="${hue}" fill-opacity="${ASSET_FAULT_TINT}" ${edge(hue)}`)
      );
    }
  }
}

const disc = (centre: number, radius: number, fill: string, stroke: string, width: number) =>
  `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;

/**
 * Every form the map can draw: 4 severities × 2 statuses for each of `INCIDENT_TYPES`, one resolved
 * form per type, the same 9 for an unknown type, 2 cameras, 4 cluster badges, 6 asset diamonds
 * (normal, no data, a fault per severity): 237 with 24 types.
 * The unknown-type forms are registered up front with the others, not on `styleimagemissing`: that
 * event needs the image added synchronously, and glyph images decode asynchronously.
 */
function markerForms(): MarkerForm[] {
  const types: readonly MarkerType[] = [...INCIDENT_TYPES, UNKNOWN_TYPE_IMAGE];
  return [
    ...types.flatMap((type): MarkerForm[] => [
      ...INCIDENT_SEVERITIES.flatMap((severity) =>
        (['open', 'acknowledged'] as const).map((status): MarkerForm => ({
          kind: 'incident',
          severity,
          status,
          type,
        })),
      ),
      { kind: 'resolved', type },
    ]),
    { kind: 'camera', online: true },
    { kind: 'camera', online: false },
    ...INCIDENT_SEVERITIES.map((severity): MarkerForm => ({ kind: 'cluster-severity', severity })),
    { kind: 'asset', look: 'normal' },
    { kind: 'asset', look: 'nodata' },
    ...INCIDENT_SEVERITIES.map((severity): MarkerForm => ({
      kind: 'asset',
      look: 'fault',
      severity,
    })),
  ];
}

/**
 * The decoded bitmaps of `forms`, one per form and named by `imageIdOf`, drawn at the device pixel
 * ratio (`ratio`: a bitmap is its CSS size times `ratio` device pixels). It needs no map, so the 3D
 * stage draws its camera markers from the very same images as the 2D map (V2-12.8). The glyph
 * renderer is disposed whether or not drawing succeeds.
 */
export async function renderMarkerImages(forms: readonly MarkerForm[]): Promise<{
  ratio: number;
  images: (readonly [id: string, image: HTMLImageElement])[];
}> {
  const ratio = pixelRatio();
  const renderer = glyphRenderer();
  let svgs: [id: string, svg: string][];
  try {
    svgs = forms.map((form) => {
      if (form.kind === 'asset') return [imageIdOf(form), markerSvg(form, '', ratio)];
      const { glyph, ...props } = glyphStyle(form);
      return [imageIdOf(form), markerSvg(form, renderer.render(glyph, props), ratio)];
    });
  } finally {
    renderer.dispose();
  }
  const images = await Promise.all(
    svgs.map(async ([id, svg]) => [id, await rasterise(svg)] as const),
  );
  return { ratio, images };
}

/**
 * Registers every marker image on `map`, then waits for the count font. Call from the map's `load`
 * handler and add the layers only after it resolves: an image that arrives after its layer is
 * missing from the tiles already laid out. Adds nothing when `signal` aborted meanwhile (the map
 * was removed).
 */
export async function registerMapImages(map: MapLibreMap, signal: AbortSignal): Promise<void> {
  const [{ ratio, images }] = await Promise.all([
    renderMarkerImages(markerForms()),
    document.fonts.load(COUNT_FONT),
  ]);
  if (signal.aborted) return;
  for (const [id, image] of images) {
    if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: ratio });
  }
}

/**
 * Draws a cluster count image (`cluster-count-3`, `cluster-count-9+`) on demand, for the map's
 * `styleimagemissing` event, which needs the image added synchronously. Returns whether it added one.
 */
export function addClusterCountImage(map: MapLibreMap, id: string): boolean {
  if (!id.startsWith(CLUSTER_COUNT_PREFIX) || map.hasImage(id)) return false;
  const ratio = pixelRatio();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = COUNT_BOX * ratio;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.scale(ratio, ratio);
  context.font = COUNT_FONT;
  context.fillStyle = mapColors.textPrimary;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(id.slice(CLUSTER_COUNT_PREFIX.length), COUNT_BOX / 2, COUNT_BOX / 2);
  map.addImage(id, context.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
  return true;
}

/** Whole device pixels, so bitmaps stay sharp; read once per registration. */
const pixelRatio = () => Math.max(1, Math.ceil(window.devicePixelRatio || 1));

/**
 * Renders glyph components to SVG markup with the bundled React DOM client, so the map uses the
 * console's own icon set (no second icon package, no server renderer in the bundle).
 */
function glyphRenderer() {
  const container = document.createElement('div');
  const root = createRoot(container);
  return {
    render(glyph: Glyph, props: Omit<GlyphStyle, 'glyph'>): string {
      flushSync(() => root.render(createElement(glyph, props)));
      return container.innerHTML;
    },
    dispose: () => root.unmount(),
  };
}

async function rasterise(svg: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  return image;
}
