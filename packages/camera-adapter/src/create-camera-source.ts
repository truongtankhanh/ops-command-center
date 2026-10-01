import type { CameraSource } from './camera-source';
import { MediaMtxCameraSource, type MediaMtxOptions } from './mediamtx-camera-source';
import { MockCameraSource } from './mock-camera-source';

export type CameraSourceConfig = { kind: 'mock' } | ({ kind: 'mediamtx' } & MediaMtxOptions);

/** Selects the implementation once, from configuration. */
export function createCameraSource(config: CameraSourceConfig): CameraSource {
  switch (config.kind) {
    case 'mock':
      return new MockCameraSource();
    case 'mediamtx':
      return new MediaMtxCameraSource(config);
  }
}
