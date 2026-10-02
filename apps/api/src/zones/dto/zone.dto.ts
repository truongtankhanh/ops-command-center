import { ApiProperty } from '@nestjs/swagger';
import { type LngLat, type Zone, ZONE_KINDS, type ZoneKind } from '@occ/contracts';

/** OpenAPI shape of `Zone`. `implements` keeps it in lockstep with the shared contract. */
export class ZoneDto implements Zone {
  /** Zone id. */
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'BLD-LIB' })
  code: string;

  @ApiProperty({ example: 'Library' })
  name: string;

  /** What kind of area this is: a `building`, `parking` lot, campus `gate` or `outdoor` space. */
  @ApiProperty({ enum: ZONE_KINDS })
  kind: ZoneKind;

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
