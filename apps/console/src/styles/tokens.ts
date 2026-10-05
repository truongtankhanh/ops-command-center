import type { Zone } from '@occ/contracts';

const zoneFill: Record<Zone['kind'], string> = {
  building: '#1d3545',
  parking: '#182d3b',
  gate: '#1d3a3b',
  outdoor: '#15302a',
};

/**
 * The colours the campus map paints with. MapLibre paint properties take literal colours and cannot
 * read CSS custom properties, so this is their single source instead of `tokens.css`.
 *
 * `ground` must stay equal to `--surface-0`: `scripts/contrast.ts --check` (run by the console's
 * `lint`) fails when they drift, and checks the zone outline against the ground (≥ 3:1).
 */
export const mapColors = {
  ground: '#0c1821',
  zoneOutline: '#56728a',
  zoneFill,
};
