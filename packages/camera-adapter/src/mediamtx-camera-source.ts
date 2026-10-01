import type { StreamDescriptor } from '@occ/contracts';
import type { CameraRef, CameraSource } from './camera-source';

export interface MediaMtxOptions {
  /** Public base URL of MediaMTX's HLS server, e.g. `http://media.local:8888`. */
  hlsBaseUrl: string;
  /** Public base URL of MediaMTX's WebRTC (WHEP) server, e.g. `http://media.local:8889`. */
  webrtcBaseUrl: string;
  protocol: 'hls' | 'webrtc';
}

/**
 * Production source: IP cameras publish RTSP to MediaMTX, which re-serves each path
 * as HLS (`/<path>/index.m3u8`) and WebRTC/WHEP (`/<path>/whep`).
 */
export class MediaMtxCameraSource implements CameraSource {
  readonly kind = 'mediamtx';

  constructor(private readonly options: MediaMtxOptions) {}

  async resolveStream(camera: CameraRef): Promise<StreamDescriptor> {
    const label = `${camera.code} · ${camera.name}`;
    const path = camera.streamPath.split('/').map(encodeURIComponent).join('/');

    if (this.options.protocol === 'webrtc') {
      return {
        kind: 'webrtc',
        cameraId: camera.id,
        label,
        url: `${trimSlash(this.options.webrtcBaseUrl)}/${path}/whep`,
      };
    }
    return {
      kind: 'hls',
      cameraId: camera.id,
      label,
      url: `${trimSlash(this.options.hlsBaseUrl)}/${path}/index.m3u8`,
    };
  }
}

const trimSlash = (url: string) => url.replace(/\/+$/, '');
