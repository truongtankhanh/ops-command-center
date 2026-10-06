import { ApiProperty } from '@nestjs/swagger';
import type { Camera, CameraFieldOfView, LngLat, StreamDescriptor } from '@occ/contracts';

/**
 * What the camera sees: a circular sector from its mounting point. Strict bounds are in the
 * descriptions: @nestjs/swagger types `exclusiveMinimum` / `exclusiveMaximum` as OpenAPI 3.0
 * booleans, which OpenAPI 3.1 replaced with numbers, so they would break a move to 3.1.
 */
export class CameraFieldOfViewDto implements CameraFieldOfView {
  @ApiProperty({
    description:
      'Centre line of the view, in degrees clockwise from true north (0 ≤ heading < 360)',
    minimum: 0,
    maximum: 360,
    example: 90,
  })
  heading: number;

  @ApiProperty({
    description: 'Width of the view, in degrees (0 < angle ≤ 360)',
    minimum: 0,
    maximum: 360,
    example: 90,
  })
  angle: number;

  @ApiProperty({ description: 'How far the camera sees, in metres (> 0)', minimum: 0, example: 40 })
  range: number;
}

export class CameraDto implements Camera {
  /** Camera id. */
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'CAM-L01' })
  code: string;

  @ApiProperty({ example: 'Library entrance' })
  name: string;

  /** Zone the camera is mounted in. */
  @ApiProperty({ format: 'uuid' })
  zoneId: string;

  @ApiProperty({
    description: 'Mounting point as [lng, lat]',
    type: [Number],
    minItems: 2,
    maxItems: 2,
  })
  position: LngLat;

  /** Whether the camera is currently online. */
  @ApiProperty()
  online: boolean;

  @ApiProperty({
    type: () => CameraFieldOfViewDto,
    nullable: true,
    description: '`null` when the orientation is not known; clients then draw no view',
  })
  fieldOfView: CameraFieldOfView | null;
}

/** Fields every stream descriptor has. Not a schema of its own — only the variants below are. */
abstract class StreamDescriptorBaseDto {
  @ApiProperty({ format: 'uuid' })
  cameraId: string;

  @ApiProperty({ example: 'CAM-L01 · Library entrance' })
  label: string;
}

/** No real camera behind it: the client draws a synthetic feed from `seed`. */
export class MockStreamDescriptorDto
  extends StreamDescriptorBaseDto
  implements Extract<StreamDescriptor, { kind: 'mock' }>
{
  @ApiProperty({ enum: ['mock'] })
  kind: 'mock';

  /** Seed for the synthetic feed. A camera always gets the same seed, so its scene is stable. */
  @ApiProperty()
  seed: number;
}

/** Play `url` as an HLS stream. */
export class HlsStreamDescriptorDto
  extends StreamDescriptorBaseDto
  implements Extract<StreamDescriptor, { kind: 'hls' }>
{
  @ApiProperty({ enum: ['hls'] })
  kind: 'hls';

  @ApiProperty({
    format: 'uri',
    description: 'HLS playlist URL',
    example: 'https://media.example.com/cam-l01/index.m3u8',
  })
  url: string;
}

/** Play `url` over WebRTC (WHEP). */
export class WebRtcStreamDescriptorDto
  extends StreamDescriptorBaseDto
  implements Extract<StreamDescriptor, { kind: 'webrtc' }>
{
  @ApiProperty({ enum: ['webrtc'] })
  kind: 'webrtc';

  @ApiProperty({
    format: 'uri',
    description: 'WHEP endpoint URL',
    example: 'https://media.example.com/cam-l01/whep',
  })
  url: string;
}
