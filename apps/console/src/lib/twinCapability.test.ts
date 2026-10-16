import { TWIN_UNAVAILABLE_COPY, twinCapability } from './twinCapability';

describe('twinCapability', () => {
  // V2-12 replaces this with the WebGL 2 check; until then the twin does not exist to be drawn.
  it('says the twin is not built yet', () => {
    expect(twinCapability()).toEqual({ available: false, reason: 'not-built' });
  });
});

describe('TWIN_UNAVAILABLE_COPY', () => {
  it('tells a build without the twin apart from a device that refuses WebGL 2', () => {
    expect(TWIN_UNAVAILABLE_COPY['not-built']).toEqual({
      title: "3D view isn't available in this version",
      detail: 'The 2D map shows the same incidents, cameras and assets.',
    });
    expect(TWIN_UNAVAILABLE_COPY['no-webgl2']).toEqual({
      title: "3D view isn't available on this device",
      detail: 'WebGL 2 is off or blocked. The 2D map shows the same incidents, cameras and assets.',
    });
  });
});
