import type { IncidentSeverity, Zone } from '@occ/contracts';

const zoneFill: Record<Zone['kind'], string> = {
  building: '#1d3545',
  parking: '#182d3b',
  gate: '#1d3a3b',
  outdoor: '#15302a',
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
 * Layout sizes the map needs as numbers (its `padding` takes pixels), copied from `tokens.css` and
 * drift-checked the same way.
 */
export const layout = {
  /** `--sheet-width`, in px: the map pads by it so the selection stays beside the open sheet. */
  sheetWidth: 440,
};
