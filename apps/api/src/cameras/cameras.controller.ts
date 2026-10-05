import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Camera, StreamDescriptor } from '@occ/contracts';
import { ApiErrorDto } from '../common/api-error.dto';
import { CamerasService } from './cameras.service';
import {
  CameraDto,
  HlsStreamDescriptorDto,
  MockStreamDescriptorDto,
  WebRtcStreamDescriptorDto,
} from './dto/camera.dto';

@ApiTags('cameras')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or invalid bearer token' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'No role grants access' })
@ApiExtraModels(MockStreamDescriptorDto, HlsStreamDescriptorDto, WebRtcStreamDescriptorDto)
@Controller('cameras')
export class CamerasController {
  constructor(private readonly cameras: CamerasService) {}

  /** Cameras, optionally filtered by zone. */
  @Get()
  @ApiQuery({ name: 'zoneId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: [CameraDto] })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Malformed zoneId' })
  list(@Query('zoneId', new ParseUUIDPipe({ optional: true })) zoneId?: string): Promise<Camera[]> {
    return this.cameras.list(zoneId);
  }

  /** How to render this camera: an HLS or WebRTC stream URL, or a seed for a synthetic feed. */
  @Get(':id/stream')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'Shape depends on `kind`',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(MockStreamDescriptorDto) },
        { $ref: getSchemaPath(HlsStreamDescriptorDto) },
        { $ref: getSchemaPath(WebRtcStreamDescriptorDto) },
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          mock: getSchemaPath(MockStreamDescriptorDto),
          hls: getSchemaPath(HlsStreamDescriptorDto),
          webrtc: getSchemaPath(WebRtcStreamDescriptorDto),
        },
      },
    },
  })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Malformed id' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Camera does not exist' })
  stream(@Param('id', ParseUUIDPipe) id: string): Promise<StreamDescriptor> {
    return this.cameras.resolveStream(id);
  }
}
