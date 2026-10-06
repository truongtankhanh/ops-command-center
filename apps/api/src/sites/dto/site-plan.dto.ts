import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  type LngLat,
  SITE_FEATURE_PARTS,
  type SiteFeature,
  type SiteFeaturePart,
  type SiteGeometry,
  type SitePlan,
} from '@occ/contracts';

const POSITION_SCHEMA = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

/** A GeoJSON `Polygon`: closed rings of [lng, lat], outer ring first. */
export class SitePolygonDto implements Extract<SiteGeometry, { type: 'Polygon' }> {
  @ApiProperty({ enum: ['Polygon'] })
  type: 'Polygon';

  @ApiProperty({
    description: 'Closed rings of [lng, lat] points, outer ring first',
    type: 'array',
    items: { type: 'array', items: POSITION_SCHEMA },
  })
  coordinates: LngLat[][];
}

/** A GeoJSON `LineString` of [lng, lat]. */
export class SiteLineStringDto implements Extract<SiteGeometry, { type: 'LineString' }> {
  @ApiProperty({ enum: ['LineString'] })
  type: 'LineString';

  @ApiProperty({
    description: '[lng, lat] points, in order',
    type: 'array',
    items: POSITION_SCHEMA,
  })
  coordinates: LngLat[];
}

export class SiteFeatureDto implements SiteFeature {
  /** What this feature draws: the site `boundary`, a `road`, or a sports-`field` marking. */
  @ApiProperty({ enum: SITE_FEATURE_PARTS })
  part: SiteFeaturePart;

  @ApiProperty({
    description: 'Shape depends on `type`',
    oneOf: [{ $ref: getSchemaPath(SitePolygonDto) }, { $ref: getSchemaPath(SiteLineStringDto) }],
    discriminator: {
      propertyName: 'type',
      mapping: {
        Polygon: getSchemaPath(SitePolygonDto),
        LineString: getSchemaPath(SiteLineStringDto),
      },
    },
  })
  geometry: SiteGeometry;
}

/** OpenAPI shape of `SitePlan`. `implements` keeps it in lockstep with the shared contract. */
export class SitePlanDto implements SitePlan {
  /** Site id. */
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LANGBIANG' })
  code: string;

  @ApiProperty({ example: 'Langbiang Tech Campus' })
  name: string;

  @ApiProperty({
    description: 'Centre of the site as [lng, lat]: where a map opens',
    type: [Number],
    minItems: 2,
    maxItems: 2,
  })
  center: LngLat;

  @ApiProperty({
    description:
      'Drawn under the zones, in drawing order. Building footprints and parking rows are not ' +
      'here: clients derive them from the zones.',
    type: [SiteFeatureDto],
  })
  features: SiteFeature[];
}
