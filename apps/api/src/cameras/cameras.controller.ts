import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Camera, StreamDescriptor } from '@occ/contracts';
import { CamerasService } from './cameras.service';
import { CameraDto, StreamDescriptorDto } from './dto/camera.dto';

@ApiTags('cameras')
@Controller('cameras')
export class CamerasController {
  constructor(private readonly cameras: CamerasService) {}

  /** Cameras, optionally filtered by zone. */
  @Get()
  @ApiQuery({ name: 'zoneId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: [CameraDto] })
  list(@Query('zoneId', new ParseUUIDPipe({ optional: true })) zoneId?: string): Promise<Camera[]> {
    return this.cameras.list(zoneId);
  }

  /** How the client should render this camera — resolved by the configured CameraSource. */
  @Get(':id/stream')
  @ApiOkResponse({ type: StreamDescriptorDto })
  stream(@Param('id', ParseUUIDPipe) id: string): Promise<StreamDescriptor> {
    return this.cameras.resolveStream(id);
  }
}
