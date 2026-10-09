import { ApiProperty } from '@nestjs/swagger';
import {
  type LngLat,
  type Zone,
  ZONE_KINDS,
  ZONE_USES,
  type ZoneKind,
  type ZoneUse,
} from '@occ/contracts';

/** OpenAPI shape of `Zone`. `implements` keeps it in lockstep with the shared contract. */
export class ZoneDto implements Zone {
  /** Zone id. */
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'BLD-LIB' })
  code: string;

  @ApiProperty({ example: 'Library' })
  name: string;

  /**
   * What kind of area this is: a `building`, `parking` lot, campus `gate`, `outdoor` space,
   * `sports` ground, `utility` area or `water`.
   */
  @ApiProperty({ enum: ZONE_KINDS })
  kind: ZoneKind;

  /**
   * What a building is used for (ADR-0021). `null` for every other kind, and for a building whose
   * use is not set. Drives report-form suggestions only; restricts nothing.
   */
  @ApiProperty({ enum: ZONE_USES, nullable: true })
  use: ZoneUse | null;

  @ApiProperty({
    description: 'Closed ring of [lng, lat] points',
    type: 'array',
    items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
  })
  polygon: LngLat[];

  @ApiProperty({
    description: 'Centre as [lng, lat]. Used as the position of incidents reported without one.',
    type: [Number],
    minItems: 2,
    maxItems: 2,
  })
  center: LngLat;
}
