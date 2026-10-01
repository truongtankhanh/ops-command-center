import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Zone } from '@occ/contracts';
import { ZoneDto } from './dto/zone.dto';
import { ZonesService } from './zones.service';

@ApiTags('zones')
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
