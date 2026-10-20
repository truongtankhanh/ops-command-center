import type { Zone } from '@occ/contracts';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from 'three';
import { GROUND_LAYERS } from '../lib/twinGround';
import { highlightRibbon } from '../lib/twinHighlight';
import type { Frame } from '../lib/twinScene';
import { mapColors } from '../styles/tokens';

/**
 * After the building faces (`GROUND_LAYERS.length`) and before their outlines and the markers: the faces write depth
 * and this tests it, so the outer half of a building's outline shows and a ring behind a wall is not drawn through it.
 */
const HIGHLIGHT_ORDER = GROUND_LAYERS.length + 0.5;

interface ZoneHighlightProps {
  zones: readonly Zone[];
  frame: Frame;
  /** The zone to outline (`useTwinHighlightZone`, the stage's), or `null` for none. */
  zoneId: string | null;
}

/**
 * The outline of the selected incident's zone, or of the zone being reported while the report form is open, on the
 * ground (V2-16.4, the 2D map's `zoneHighlight`): the accent, drawn as a ribbon in metres along the zone's ring
 * (`lib/twinHighlight.ts`) because a WebGL line is one pixel wide. One mesh and one draw call, and nothing while no
 * zone is named or the zone has no ring. It does not follow the Incidents layer, as the map's does not: it marks a
 * place, not an incident. The geometry is built when the zone changes and disposed when it is replaced or unmounted;
 * R3F does not dispose a geometry it was handed as a prop.
 *
 * Not unit-tested: it is R3F glue, and jsdom has no WebGL. Its logic is `lib/twinHighlight.ts`.
 */
export function ZoneHighlight({ zones, frame, zoneId }: ZoneHighlightProps) {
  const geometry = useMemo(() => {
    const ribbon = zoneId === null ? null : highlightRibbon(zones, frame, zoneId);
    if (ribbon === null) return null;
    const built = new BufferGeometry();
    built.setAttribute('position', new Float32BufferAttribute(ribbon.positions, 3));
    built.setIndex(ribbon.indices);
    return built;
  }, [zones, frame, zoneId]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (geometry === null) return null;
  return (
    <mesh geometry={geometry} renderOrder={HIGHLIGHT_ORDER}>
      <meshBasicMaterial color={mapColors.accent} side={DoubleSide} depthWrite={false} />
    </mesh>
  );
}
