import type { IncidentSeverity, Zone } from '@occ/contracts';

const zoneFill: Record<Zone['kind'], string> = {
  building: '#1d3545',
  parking: '#182d3b',
  gate: '#1d3a3b',
  outdoor: '#15302a',
  // No frame draws a sports zone (V2-03.1): an olive no other fill uses, in the same lightness band.
  sports: '#24361e',
  // `utility` and `water` as twin.css draws them (`.tw-zone[data-kind]`).
  utility: '#1a282e',
  water: '#112833',
};

/**
 * The site plan under the zones (frame 01). Decorative: only the zone outline, the zone labels and
 * the zone highlight drawn over the boundary carry meaning, and `scripts/contrast.ts` checks those.
 */
const site = {
  boundaryFill: '#0f1d27',
  boundaryLine: '#34495a',
  road: '#182a36',
  footprint: '#24404f',
  fieldLine: '#2a4a43',
  parkingLine: '#2a4152',
};

/** Copies of `--sev-*`. */
const severity: Record<IncidentSeverity, string> = {
  critical: '#ff426d',
  high: '#ffad42',
  medium: '#f2d04b',
  low: '#87a2c4',
};

/**
 * The colours the campus map paints with. MapLibre paint properties and the marker images take
 * literal colours and cannot read CSS custom properties, so this is their single source instead of
 * `tokens.css`.
 *
 * Every value except `zoneOutline`, `zoneFill` and `site` is a copy of the `tokens.css` token in
 * its comment: `scripts/contrast.ts --check` (run by the console's `lint`) fails when a copy drifts,
 * and checks the zone outline against the ground and the site boundary (≥ 3:1).
 */
export const mapColors = {
  /** `--surface-0` */
  ground: '#07111f',
  zoneOutline: '#56728a',
  zoneFill,
  site,
  severity,
  /** `--surface-1` */
  surface1: '#0d1c2d',
  /** `--surface-2` */
  surface2: '#12263b',
  /** `--surface-3` */
  surface3: '#1a3250',
  /** `--accent` */
  accent: '#3185ff',
  /** `--on-accent` */
  onAccent: '#07111f',
  /** `--text-primary` */
  textPrimary: '#e7f2ff',
  /** `--text-secondary` */
  textSecondary: '#a6b8c5',
  /** `--text-tertiary` */
  textTertiary: '#91a5b4',
  /** `--tw-stale-edge`: the dashed edge of an asset with no data (frame 14 `.is-stale`). */
  staleEdge: '#4a555c',
};

/** Map animation timing, copied from `tokens.css` for the same reason and drift-checked the same way. */
export const mapMotion = {
  /** `--duration-pulse`, in ms. */
  pulseMs: 1800,
};

/** The three faces of a part's material, lit from the north-west (frame 00). */
interface Faces {
  top: string;
  south: string;
  east: string;
}

/**
 * The colours the 3D twin paints with (ADR-0020, V2-12.6). WebGL cannot read custom properties, so
 * these are copies of the `--tw-*` and `--heat-*` tokens, like `mapColors`: `scripts/contrast.ts
 * --check` (run by the console's `lint`) fails when a copy drifts from `tokens.css`.
 *
 * `ground` and `road` have the same hex as `mapColors.site.boundaryFill` and `road` because the
 * mockups drew them alike; they are not linked, so the 2D map and the 3D scene can diverge later.
 * The model contract's material names (`lib/twin-core/twinMaterials.ts`, V2-14.7) are `Part` = `idle`, `Steel`, `Concrete`,
 * `Rail`, `Blade`, `Hub`, `Screen` and `Xray` (`idle` at `xrayOpacity`).
 */
export const twinColors = {
  /** `--tw-ground`: the site boundary's fill. */
  ground: '#0f1d27',
  /** `--tw-grid`: the 50 m grid. Decorative, on purpose barely above the ground. */
  grid: '#14242f',
  /** `--tw-road` */
  road: '#182a36',
  /** `--tw-edge`: a part's outline. */
  edge: '#3e5a6e',
  /** `--tw-rail`: handrails, ladders and fan guard mesh. */
  rail: '#8199aa',
  /** `--tw-neutral`: the base of an asset with no model, drawn as a box (frame 15). */
  neutral: '#4b5d6b',
  /** `--tw-blade`: fan blades. */
  blade: '#4d6a80',
  /** `--tw-hub`: a rotor's hub, and the edge of a see-through shell. */
  hub: '#5a7488',
  /** `--tw-screen`: a display. */
  screen: '#2b3f66',
  /** `--tw-xray-opacity`: a see-through shell, such as the generator's enclosure. */
  xrayOpacity: 0.14,
  /** `--tw-top` / `-south` / `-east`: the idle part material. */
  idle: { top: '#274152', south: '#1f3748', east: '#172b3a' } satisfies Faces,
  /** `--tw-steel-*`: motors, pumps, pipes, valves and cabinets. */
  steel: { top: '#435766', south: '#334553', east: '#273745' } satisfies Faces,
  /** `--tw-concrete-*`: basins, plinths and skids. */
  concrete: { top: '#363c41', south: '#2b3034', east: '#22262a' } satisfies Faces,
  /** `--tw-hover-*`: 30 % `--accent` into the idle material; the edge is `--accent`. */
  hover: { top: '#2a5586', south: '#244e7f', east: '#1f4675' } satisfies Faces,
  /**
   * `--tw-alarm-*`: `--tw-alarm-mix` (35 %) of `--sev-critical` into the idle material. Only the critical
   * faces are tokens; the scene mixes the other severities with the same weight.
   */
  alarm: { top: '#73415b', south: '#6d3b55', east: '#68334c' } satisfies Faces,
  /**
   * `--tw-alarm-mix` as a fraction: how much of an alarmed asset's severity is mixed into each of its materials
   * (`tintFor`, V2-14.9). The critical faces above are what this weight gives for `--tw-top`; every other
   * severity and material is mixed in the scene.
   */
  alarmMix: 0.35,
  /** `--tw-stale-*`: no recent data, desaturated faces. */
  stale: { top: '#2b3338', south: '#22292e', east: '#1b2125' } satisfies Faces,
  /** `--tw-stale-edge`: no recent data, the dashed edge. */
  staleEdge: '#4a555c',
  /** `--tw-ghost-opacity`: the rest of the campus while one asset is isolated. */
  ghostOpacity: 0.18,
  /** `--heat-0` … `--heat-5`: the telemetry overlay's ramp, in the accent's hue. */
  heat: ['#132b50', '#1c3d6f', '#22539c', '#266cd5', '#5292f2', '#9bc3ff'],
} as const;

/**
 * The console's display modes by CSS width, in px (UI-17). Media queries cannot read custom
 * properties, so CSS repeats these numbers:
 *
 * - `phone`: `max-width` — the map stacks above the feed, the sheet covers the screen (a fallback,
 *   not a designed phone layout).
 * - `tablet`: `max-width` — a narrower feed, the KPI tiles on their own header row, a 2 × 2 strip.
 * - laptop: everything between — the reference layout of the mockups (1440 px frames).
 * - `wall` / `wall4k`: `min-width` — `--ui-scale` grows (tokens.css) and the strip holds more
 *   tiles.
 *
 * `scripts/contrast.ts --check` compares `wall` and `wall4k` with the `min-width` media queries of
 * `tokens.css`; `phone` and `tablet` repeat in many modules and are not checked.
 */
export const breakpoints = {
  phone: 720,
  tablet: 1100,
  wall: 1920,
  wall4k: 3200,
} as const;

/**
 * The markup of `public/favicon.svg`. A copy because Vite serves `public/` as is and refuses to let
 * script import from it; the title badge (`useAttentionBadge`) draws a dot over this mark.
 * `scripts/contrast.ts --check` fails when it no longer matches the file.
 */
export const faviconMark =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#07111f"/><circle cx="16" cy="16" r="9" fill="none" stroke="#e7f2ff" stroke-width="2"/><circle cx="16" cy="16" r="3.5" fill="#3185ff"/></svg>';
