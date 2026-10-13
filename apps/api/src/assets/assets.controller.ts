import { Controller, Get, Param } from '@nestjs/common';
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
import type { Asset, AssetDetail } from '@occ/contracts';
import { ApiErrorDto } from '../common/api-error.dto';
import { AssetsService } from './assets.service';
import { AssetDetailDto, AssetDto } from './dto/asset.dto';
import { ASSET_CODE_PATTERN, ParseAssetCodePipe } from './parse-asset-code.pipe';

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
}
