import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type CameraSource, createCameraSource } from '@occ/camera-adapter';
import type { Env } from '../config/env.validation';

export const CAMERA_SOURCE = Symbol('CAMERA_SOURCE');

/** Chooses the camera source once, at startup, from `CAMERA_SOURCE` (see ADR-0002). */
export const cameraSourceProvider: Provider<CameraSource> = {
  provide: CAMERA_SOURCE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => {
    const kind = config.get('CAMERA_SOURCE', { infer: true });
    if (kind === 'mediamtx') {
      return createCameraSource({
        kind,
        hlsBaseUrl: config.get('MEDIAMTX_HLS_URL', { infer: true })!,
        webrtcBaseUrl: config.get('MEDIAMTX_WEBRTC_URL', { infer: true })!,
        protocol: config.get('MEDIAMTX_PROTOCOL', { infer: true }),
      });
    }
    return createCameraSource({ kind: 'mock' });
  },
};
