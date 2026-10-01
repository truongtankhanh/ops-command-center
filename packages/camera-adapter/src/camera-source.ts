import type { StreamDescriptor } from '@occ/contracts';

/** The minimum a CameraSource needs to know about a camera. */
export interface CameraRef {
  id: string;
  code: string;
  name: string;
  /** Path of the camera's stream on the media server, e.g. `campus/cam-a01`. */
  streamPath: string;
}

/**
 * Port: turns a camera into something a browser can render.
 * Implementations decide *where* video comes from; callers never do.
 */
export interface CameraSource {
  readonly kind: string;
  resolveStream(camera: CameraRef): Promise<StreamDescriptor>;
}
