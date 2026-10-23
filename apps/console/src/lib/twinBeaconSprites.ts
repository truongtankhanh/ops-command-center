import { severityRank } from '@occ/contracts';
import { discRadiusOf, imageIdOf, MARKER_BOX, type MarkerForm } from './map/mapImages';
import { mapColors } from '../styles/tokens';
import type { Beacon } from './twinBeacons';
import type { AtlasLayout, MarkerPlacement } from './twinMarkers';

/*
 * The incident beacons as sprites (V2-16.3, ADR-0020 "Settled in V2-16.3"): which cells the atlas needs, and the
 * placements that draw them, as plain data. No `three`, no canvas and no DOM, so the geometry the shader and the
 * texture cannot be checked for here (an offset that puts a ring beside its disc, a pill on the wrong side, a
 * paint order that hides a critical beacon) is tested without WebGL.
 *
 * A beacon is up to four **sprites** of one mesh, all in the one atlas (frames 01 and 04, `TwinScene.dc.html`):
 *
 * - the **base**: a ground ellipse, a 2 px stem and the 2D map's marker bitmap for the form (`imageIdOf`), in one
 *   cell. Its bottom-centre is the sprite's anchor and stands on `Beacon.position`;
 * - the **selection ring**, a ring of the accent round the disc, in one cell per disc radius;
 * - the **pulse ring**, one cell for all, which the shader grows and fades along the map's wave;
 * - the **tag pill**, one cell per tag, beside the disc.
 *
 * The rings and the pill are sprites of their own with a pixel offset from the base's anchor, so the atlas holds a
 * handful of cells and not one for every form × selected × tag. Sizes are in CSS pixels here; the atlas holds them
 * at the bitmaps' device ratio, which `beaconPlacements` reads back from the layout.
 */

/** Where the ellipse is: its half-height, so the cell's bottom is its lowest point (the ground point). */
export const ELLIPSE = { rx: 7, ry: 4, alpha: 0.35 } as const;
/** The stem's width: the frames' 2 px. */
export const STEM_WIDTH_PX = 2;
/** From the cell's bottom (the ground point) to the disc's centre: the ellipse's `ry` and the frames' 24 px stem. */
export const DISC_CENTRE_PX = ELLIPSE.ry + 24;
/** The base cell: the map's marker box, with the stem and the ellipse under it. */
export const BASE_CELL = { width: MARKER_BOX, height: DISC_CENTRE_PX + MARKER_BOX / 2 } as const;

/** The selection ring stands this far outside the disc (frames: `r + 5`), and is this thick. */
export const RING_GAP_PX = 5;
export const RING_STROKE_PX = 2.5;
/** The pulse ring's radius at rest (the map's wave, `PULSE_WAVE.radius`), its stroke and its box. */
export const PULSE_RING = { radius: 12, stroke: 2, box: 28 } as const;
/** The tag pill (frame 04 `tag`): height, text padding each side, and the gap between the disc and the pill. */
export const PILL = {
  height: 18,
  padding: 7,
  gap: 8,
  font: '600 11px "Barlow Semi Condensed", sans-serif',
} as const;

/** A cell the atlas has to hold, and what draws it. The pill's width is the text's and is known when it is drawn. */
export type CellSpec =
  | { kind: 'base'; id: string; width: number; height: number; form: MarkerForm; hue: string }
  | { kind: 'ring'; id: string; width: number; height: number; radius: number }
  | { kind: 'pulse'; id: string; width: number; height: number; radius: number; hue: string }
  | { kind: 'pill'; id: string; height: number; text: string };

const BASE_PREFIX = 'beacon:';
const RING_PREFIX = 'beacon-ring:';
const PULSE_ID = 'beacon-pulse';
const PILL_PREFIX = 'beacon-tag:';

/** The two marker forms an incident has: an active one (open or acknowledged) and a resolved one. */
type IncidentForm = Extract<MarkerForm, { kind: 'incident' | 'resolved' }>;

/** The map's marker form a beacon is drawn from: filled while open, a ring while acknowledged, neutral resolved. */
export function beaconForm(beacon: Pick<Beacon, 'form' | 'severity' | 'type'>): IncidentForm {
  switch (beacon.form) {
    case 'filled':
      return { kind: 'incident', severity: beacon.severity, status: 'open', type: beacon.type };
    case 'hollow':
      return {
        kind: 'incident',
        severity: beacon.severity,
        status: 'acknowledged',
        type: beacon.type,
      };
    case 'resolved':
      return { kind: 'resolved', type: beacon.type };
  }
}

/** The hue of the ellipse and the stem: the severity's, neutral for a resolved incident (as its disc is). */
const hueOf = (beacon: Pick<Beacon, 'form' | 'severity'>): string =>
  beacon.form === 'resolved' ? mapColors.textTertiary : mapColors.severity[beacon.severity];

/** The radius of a beacon's disc in CSS pixels (the map's step by severity): the hit target is built on it (V2-16.4). */
export const beaconRadius = (beacon: Pick<Beacon, 'form' | 'severity' | 'type'>): number =>
  discRadiusOf(beaconForm(beacon));

const baseId = (beacon: Pick<Beacon, 'form' | 'severity' | 'type'>): string =>
  `${BASE_PREFIX}${imageIdOf(beaconForm(beacon))}`;

const ringId = (radius: number): string => `${RING_PREFIX}${radius}`;

/**
 * The cells `beacons` need, each once, in the order they are first needed: a base for every form, a ring for every
 * disc radius that is selected, the pulse ring if any beacon pulses, a pill for every tag. No cell for no beacons.
 */
export function beaconCells(beacons: readonly Beacon[]): CellSpec[] {
  const cells = new Map<string, CellSpec>();
  const need = (cell: CellSpec) => {
    if (!cells.has(cell.id)) cells.set(cell.id, cell);
  };
  for (const beacon of beacons) {
    need({
      kind: 'base',
      id: baseId(beacon),
      ...BASE_CELL,
      form: beaconForm(beacon),
      hue: hueOf(beacon),
    });
    if (beacon.selected) {
      const radius = beaconRadius(beacon);
      const box = Math.ceil(2 * (radius + RING_GAP_PX + RING_STROKE_PX) + 2);
      need({ kind: 'ring', id: ringId(radius), width: box, height: box, radius });
    }
    if (beacon.pulse) {
      need({
        kind: 'pulse',
        id: PULSE_ID,
        width: PULSE_RING.box,
        height: PULSE_RING.box,
        radius: PULSE_RING.radius,
        hue: mapColors.severity.critical,
      });
    }
    if (beacon.tag !== null) {
      need({
        kind: 'pill',
        id: `${PILL_PREFIX}${beacon.tag}`,
        height: PILL.height,
        text: beacon.tag,
      });
    }
  }
  return [...cells.values()];
}

const SELECTED_LAST = 100;

/**
 * How late a beacon is painted: resolved first (neutral, under everything), then by severity, an open one above an
 * acknowledged one of its severity (the map's `sortKey`); the selected one last of all. The order is only for
 * painting: `beaconsOf` orders its list by code. Picking uses the same number to settle beacons that overlap
 * (V2-16.4), so that what is seen on top is what is hit.
 */
export const paintRank = (beacon: Pick<Beacon, 'form' | 'severity' | 'selected'>): number =>
  (beacon.selected ? SELECTED_LAST : 0) +
  (beacon.form === 'resolved'
    ? 0
    : 1 + severityRank(beacon.severity) * 2 + (beacon.form === 'filled' ? 1 : 0));

/**
 * The sprites to draw, painted in order: for each beacon the pulse ring, the selection ring, the base and the
 * tag pill, so a ring is under its disc and a pill above it. Each sprite's cell and size come from `layout` (the
 * atlas as drawn, at `ratio` device pixels per CSS pixel), and its offset places its anchor (bottom-centre) so the
 * ring is centred on the disc and the pill sits beside it, vertically centred. A beacon whose base cell is not in
 * the atlas yet is left out whole, and so is an overlay whose own cell is not (a pill waits for its font); they
 * appear as the atlas fills. `animate` is false under reduced motion: no pulse ring is placed then.
 */
export function beaconPlacements(
  beacons: readonly Beacon[],
  layout: AtlasLayout,
  ratio: number,
  { animate }: { animate: boolean },
): MarkerPlacement[] {
  const cells = new Map(layout.cells.map((cell) => [cell.id, cell]));
  const heightOf = (id: string): number => (cells.get(id)?.height ?? 0) / ratio;
  const widthOf = (id: string): number => (cells.get(id)?.width ?? 0) / ratio;

  const ordered = [...beacons].sort((a, b) => paintRank(a) - paintRank(b));

  const placements: MarkerPlacement[] = [];
  for (const beacon of ordered) {
    const base = baseId(beacon);
    if (!cells.has(base)) continue;
    const { position } = beacon;
    const radius = beaconRadius(beacon);
    const around = (id: string, suffix: string, extra: Pick<MarkerPlacement, 'phase'> = {}) => {
      placements.push({
        id: `${beacon.id}:${suffix}`,
        position,
        image: id,
        offset: [0, DISC_CENTRE_PX - heightOf(id) / 2],
        ...extra,
      });
    };

    if (beacon.pulse && animate && cells.has(PULSE_ID)) around(PULSE_ID, 'pulse', { phase: 0 });
    if (beacon.selected && cells.has(ringId(radius))) around(ringId(radius), 'ring');
    placements.push({ id: `${beacon.id}:base`, position, image: base });
    const pill = beacon.tag === null ? null : `${PILL_PREFIX}${beacon.tag}`;
    if (pill !== null && cells.has(pill)) {
      placements.push({
        id: `${beacon.id}:tag`,
        position,
        image: pill,
        offset: [radius + PILL.gap + widthOf(pill) / 2, DISC_CENTRE_PX - heightOf(pill) / 2],
      });
    }
  }
  return placements;
}

/**
 * Whether the layer should keep asking for frames: it is shown, motion is allowed (`animate`), the tab is in view
 * and some beacon pulses. Otherwise the on-demand canvas draws nothing at rest.
 */
export function pulseRunning({
  shown,
  animate,
  hidden,
  beacons,
}: {
  shown: boolean;
  animate: boolean;
  hidden: boolean;
  beacons: readonly Pick<Beacon, 'pulse'>[];
}): boolean {
  return shown && animate && !hidden && beacons.some((beacon) => beacon.pulse);
}

/** A beacon that can be hit (V2-16.4): where it stands, the radius of its disc and where it is painted. */
export interface BeaconTarget {
  id: string;
  /** The ground point, as `Beacon.position`: the picker projects it and lifts the disc by `DISC_CENTRE_PX`. */
  position: Beacon['position'];
  radius: number;
  rank: number;
}

/**
 * The beacons that may be hit: the ones whose base sprite is among `placements`, i.e. the ones that are drawn. A
 * beacon whose bitmap has not decoded yet is left out of the picture (`beaconPlacements`) and so out of the hit list
 * (V2-15.3: the registry follows what is drawn).
 */
export function beaconTargets(
  beacons: readonly Beacon[],
  placements: readonly Pick<MarkerPlacement, 'id'>[],
): BeaconTarget[] {
  const drawn = new Set(placements.map(({ id }) => id));
  return beacons
    .filter((beacon) => drawn.has(`${beacon.id}:base`))
    .map((beacon) => ({
      id: beacon.id,
      position: beacon.position,
      radius: beaconRadius(beacon),
      rank: paintRank(beacon),
    }));
}
