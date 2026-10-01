import type { StreamDescriptor } from '@occ/contracts';
import type { CameraRef, CameraSource } from './camera-source';

/**
 * Development / demo source: no video infrastructure required.
 * Clients render a synthetic feed; the seed keeps each camera's look stable across reloads.
 */
export class MockCameraSource implements CameraSource {
  readonly kind = 'mock';

  async resolveStream(camera: CameraRef): Promise<StreamDescriptor> {
    return {
      kind: 'mock',
      cameraId: camera.id,
      label: `${camera.code} · ${camera.name}`,
      seed: stableSeed(camera.id),
    };
  }
}

/** FNV-1a 32-bit hash — deterministic, dependency-free. */
export function stableSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
