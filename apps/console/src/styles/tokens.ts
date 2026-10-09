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
  critical: '#ff5a4e',
  high: '#ff9f43',
  medium: '#f2d04b',
  low: '#6cc3d5',
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
  ground: '#0c1821',
  zoneOutline: '#56728a',
  zoneFill,
  site,
  severity,
  /** `--surface-1` */
  surface1: '#13222d',
  /** `--surface-3` */
  surface3: '#223848',
  /** `--accent` */
  accent: '#8c9bff',
  /** `--on-accent` */
  onAccent: '#0c1821',
  /** `--text-primary` */
  textPrimary: '#e4edf3',
  /** `--text-secondary` */
  textSecondary: '#a6b8c5',
  /** `--text-tertiary` */
  textTertiary: '#91a5b4',
};

/** Map animation timing, copied from `tokens.css` for the same reason and drift-checked the same way. */
export const mapMotion = {
  /** `--duration-pulse`, in ms. */
  pulseMs: 1800,
};

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
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0c1821"/><circle cx="16" cy="16" r="9" fill="none" stroke="#e4edf3" stroke-width="2"/><circle cx="16" cy="16" r="3.5" fill="#8c9bff"/></svg>';
