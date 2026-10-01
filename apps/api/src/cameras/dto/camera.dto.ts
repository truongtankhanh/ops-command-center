import { ApiProperty } from '@nestjs/swagger';
import type { Camera, LngLat } from '@occ/contracts';

export class CameraDto implements Camera {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'CAM-L01' })
  code: string;

  @ApiProperty({ example: 'Library entrance' })
  name: string;

  @ApiProperty({ format: 'uuid' })
  zoneId: string;

  @ApiProperty({ description: '[lng, lat]', type: [Number], minItems: 2, maxItems: 2 })
  position: LngLat;

  @ApiProperty()
  online: boolean;
}

/** How to render a camera. `url` is present for `hls` and `webrtc`; `seed` for `mock`. */
export class StreamDescriptorDto {
  @ApiProperty({ enum: ['mock', 'hls', 'webrtc'] })
  kind: 'mock' | 'hls' | 'webrtc';

  @ApiProperty({ format: 'uuid' })
  cameraId: string;

  @ApiProperty({ example: 'CAM-L01 · Library entrance' })
  label: string;

  @ApiProperty({ required: false })
  url?: string;

  @ApiProperty({ required: false })
  seed?: number;
}
