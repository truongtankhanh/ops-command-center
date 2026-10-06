import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { SitePlan } from '@occ/contracts';
import { ApiErrorDto } from '../common/api-error.dto';
import { SiteLineStringDto, SitePlanDto, SitePolygonDto } from './dto/site-plan.dto';
import { SitesService } from './sites.service';

@ApiTags('site-plan')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or invalid bearer token' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'No role grants access' })
@ApiTooManyRequestsResponse({
  type: ApiErrorDto,
  description: 'Rate limit exceeded; see Retry-After',
})
@ApiExtraModels(SitePolygonDto, SiteLineStringDto)
@Controller('site-plan')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  /** What to draw under the zones: the site boundary, roads and field markings. */
  @Get()
  @ApiOkResponse({ type: SitePlanDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No site plan has been set up' })
  getPlan(): Promise<SitePlan> {
    return this.sites.getPlan();
  }
}
