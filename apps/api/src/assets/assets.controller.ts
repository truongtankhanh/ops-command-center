import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Asset, AssetDetail, AssetTelemetry } from '@occ/contracts';
import { ApiErrorDto } from '../common/api-error.dto';
import { AssetsService } from './assets.service';
import { AssetDetailDto, AssetDto } from './dto/asset.dto';
import { AssetTelemetryDto, AssetTelemetryQueryDto } from './dto/asset-telemetry.dto';
import { ASSET_CODE_PATTERN, ParseAssetCodePipe } from './parse-asset-code.pipe';
import { resolveTelemetryRange } from './telemetry-range';

/**
 * Read-only on purpose: the API has no write route for assets and no command path to any device
 * (ADR-0018). Any known role reads, so there is no `@RequirePermission`, and the default rate
 * limit applies.
 */
@ApiTags('assets')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or invalid bearer token' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'No role grants access' })
@ApiTooManyRequestsResponse({
  type: ApiErrorDto,
  description: 'Rate limit exceeded; see Retry-After',
})
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /** Every asset ordered by code, with its class, position and headline points. */
  @Get()
  @ApiOkResponse({ type: [AssetDto] })
  list(): Promise<Asset[]> {
    return this.assets.list();
  }

  /** One asset by its code, with all the points of its class and the rules that apply to it. */
  @Get(':code')
  @ApiParam({
    name: 'code',
    description: "The operators' tag, case-sensitive",
    schema: { type: 'string', pattern: ASSET_CODE_PATTERN.source, example: 'CT-01' },
  })
  @ApiOkResponse({ type: AssetDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Malformed asset code' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Asset does not exist' })
  get(@Param('code', ParseAssetCodePipe) code: string): Promise<AssetDetail> {
    return this.assets.get(code);
  }

  /**
   * An asset's reading history in `[from, to)`: 5 s buckets, at most 1 hour per call. The range is
   * resolved here, after the global pipe has validated the query and before the lookup, so a bad
   * range is `400` even for an asset that does not exist.
   */
  @Get(':code/telemetry')
  @ApiParam({
    name: 'code',
    description: "The operators' tag, case-sensitive",
    schema: { type: 'string', pattern: ASSET_CODE_PATTERN.source, example: 'CT-01' },
  })
  @ApiOkResponse({ type: AssetTelemetryDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description:
      'Malformed asset code, a `from` or `to` that is not ISO 8601 with a zone, `to` before ' +
      '`from`, or a range over 1 hour (720 buckets)',
  })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Asset does not exist' })
  history(
    @Param('code', ParseAssetCodePipe) code: string,
    @Query() query: AssetTelemetryQueryDto,
  ): Promise<AssetTelemetry> {
    const range = resolveTelemetryRange(query, new Date());
    if (!range.ok) throw new BadRequestException(range.problems);
    return this.assets.history(code, range.from, range.to);
  }
}
