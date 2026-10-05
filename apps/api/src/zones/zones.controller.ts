import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Zone } from '@occ/contracts';
import { ApiErrorDto } from '../common/api-error.dto';
import { ZoneDto } from './dto/zone.dto';
import { ZonesService } from './zones.service';

@ApiTags('zones')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or invalid bearer token' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'No role grants access' })
@ApiTooManyRequestsResponse({
  type: ApiErrorDto,
  description: 'Rate limit exceeded; see Retry-After',
})
@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  /** All zones of the campus with their outlines. */
  @Get()
  @ApiOkResponse({ type: [ZoneDto] })
  list(): Promise<Zone[]> {
    return this.zones.list();
  }
}
