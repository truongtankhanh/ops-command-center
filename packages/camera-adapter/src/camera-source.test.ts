import { describe, expect, it } from 'vitest';
import { createCameraSource, MediaMtxCameraSource, MockCameraSource, stableSeed } from './index';

const camera = {
  id: 'c1',
  code: 'CAM-A01',
  name: 'Library entrance',
  streamPath: 'campus/cam a01',
};

describe('MockCameraSource', () => {
  it('resolves a mock descriptor with a stable seed', async () => {
    const source = new MockCameraSource();
    const first = await source.resolveStream(camera);
    const second = await source.resolveStream(camera);

    expect(first).toEqual({
      kind: 'mock',
      cameraId: 'c1',
      label: 'CAM-A01 · Library entrance',
      seed: stableSeed('c1'),
    });
    expect(second).toEqual(first);
  });

  it('gives different cameras different seeds', () => {
    expect(stableSeed('c1')).not.toBe(stableSeed('c2'));
  });
});

describe('MediaMtxCameraSource', () => {
  const options = {
    hlsBaseUrl: 'http://media.local:8888/',
    webrtcBaseUrl: 'http://media.local:8889',
  };

  it('maps a stream path to the HLS playlist, encoding each segment', async () => {
    const source = new MediaMtxCameraSource({ ...options, protocol: 'hls' });
    await expect(source.resolveStream(camera)).resolves.toMatchObject({
      kind: 'hls',
      url: 'http://media.local:8888/campus/cam%20a01/index.m3u8',
    });
  });

  it('maps a stream path to the WHEP endpoint for WebRTC', async () => {
    const source = new MediaMtxCameraSource({ ...options, protocol: 'webrtc' });
    await expect(source.resolveStream(camera)).resolves.toMatchObject({
      kind: 'webrtc',
      url: 'http://media.local:8889/campus/cam%20a01/whep',
    });
  });
});

describe('createCameraSource', () => {
  it('selects the implementation from configuration', () => {
    expect(createCameraSource({ kind: 'mock' }).kind).toBe('mock');
    expect(
      createCameraSource({
        kind: 'mediamtx',
        ...{ hlsBaseUrl: 'h', webrtcBaseUrl: 'w' },
        protocol: 'hls',
      }).kind,
    ).toBe('mediamtx');
  });
});
