import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AssetTelemetry, AssetTelemetrySample, TelemetryValue } from '@occ/contracts';
import { IsISO8601, IsOptional, Matches } from 'class-validator';
import type { TelemetryRangeQuery } from '../telemetry-range';

// Strict bounds are in the descriptions, not schema keywords, as in `asset.dto.ts`.

/**
 * `from` and `to` need a time and a zone (`Z` or `±hh:mm`): without one, `Date` would read the
 * value in the server's time zone, and the same request would answer differently per host.
 */
const WITH_TIME_AND_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// Two checks, two messages: `IsISO8601` is what refuses `2026-02-30` (`Date` would roll it over to
// March), `Matches` is what demands the time and the zone. Garbage fails both and says both.
const NOT_A_DATE = (field: string) => `${field} must be a valid ISO 8601 date and time`;
const NO_TIME_OR_ZONE = (field: string) =>
  `${field} must include a time and a zone, such as 2026-10-14T08:00:00Z`;

/** `GET /assets/:code/telemetry`. Unknown parameters are refused by the global pipe. */
export class AssetTelemetryQueryDto implements TelemetryRangeQuery {
  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Start of the range, inclusive: ISO 8601 with a time and a zone. Defaults to `to` minus ' +
      '15 minutes. `to − from` is at most 1 hour (720 buckets of 5 seconds).',
    example: '2026-10-14T08:00:00Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true }, { message: NOT_A_DATE('from') })
  @Matches(WITH_TIME_AND_ZONE, { message: NO_TIME_OR_ZONE('from') })
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'End of the range, exclusive: ISO 8601 with a time and a zone. Defaults to now. A time ' +
      'in the future is valid and returns what exists.',
    example: '2026-10-14T08:15:00Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true }, { message: NOT_A_DATE('to') })
  @Matches(WITH_TIME_AND_ZONE, { message: NO_TIME_OR_ZONE('to') })
  to?: string;
}

/** OpenAPI shape of `AssetTelemetrySample`. `implements` keeps it in lockstep with the contract. */
export class AssetTelemetrySampleDto implements AssetTelemetrySample {
  @ApiProperty({
    format: 'date-time',
    description:
      "Start of the 5 second bucket, UTC: the API's clock when it received the reading, not " +
      "the device's measurement time.",
    example: '2026-10-14T08:00:05.000Z',
  })
  at: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }],
    },
    description:
      'The last value of each point key received in the bucket, by `key`. A key with no ' +
      'reading in the bucket is absent: it is not `null` and it is not zero.',
    example: { motorTempC: 61.5, running: true, switchState: 'auto' },
  })
  values: Record<string, TelemetryValue>;
}

/** OpenAPI shape of `AssetTelemetry`. */
export class AssetTelemetryDto implements AssetTelemetry {
  @ApiProperty({ description: "The asset's tag, as in the path", example: 'CT-01' })
  assetCode: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Start of the range served, inclusive: the request with its defaults applied.',
    example: '2026-10-14T08:00:00.000Z',
  })
  from: string;

  @ApiProperty({
    format: 'date-time',
    description: 'End of the range served, exclusive: the request with its defaults applied.',
    example: '2026-10-14T08:15:00.000Z',
  })
  to: string;

  @ApiProperty({ description: 'Width of one bucket, in seconds', example: 5 })
  bucketS: number;

  @ApiProperty({
    type: () => [AssetTelemetrySampleDto],
    description:
      'In ascending time. Empty, not an error, for an asset with no readings in the range and ' +
      'for a range outside the kept days.',
  })
  samples: AssetTelemetrySampleDto[];
}
