import {
  forgetWebgl2Probe,
  TWIN_UNAVAILABLE_COPY,
  twinCapability,
  webgl2Supported,
} from './twinCapability';

/** A WebGL 2 context that can be created, or what `getContext` answers when it cannot. */
function stubContext(answer: 'webgl2' | 'none' | 'throws') {
  const loseContext = vi.fn();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    if (answer === 'throws') throw new Error('no canvas');
    return answer === 'none' ? null : ({ getExtension: () => ({ loseContext }) } as never);
  });
  return { getContext, loseContext };
}

describe('twinCapability', () => {
  beforeEach(() => {
    forgetWebgl2Probe();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    forgetWebgl2Probe();
  });

  describe('the order of the reasons', () => {
    it('says there is no WebGL 2 where the device refuses it', () => {
      stubContext('none');

      expect(twinCapability()).toEqual({ available: false, reason: 'no-webgl2' });
    });

    it('puts a missing WebGL 2 before a fault', () => {
      stubContext('none');

      expect(twinCapability('context-lost')).toEqual({ available: false, reason: 'no-webgl2' });
    });

    it('reports a fault where everything else is fine', () => {
      stubContext('webgl2');

      expect(twinCapability('context-lost')).toEqual({ available: false, reason: 'context-lost' });
    });

    it('is available with WebGL 2 and no fault', () => {
      stubContext('webgl2');

      expect(twinCapability()).toEqual({ available: true });
      expect(twinCapability(null)).toEqual({ available: true });
    });
  });

  describe('the WebGL 2 probe', () => {
    it('asks once and releases the context it created', () => {
      const { getContext, loseContext } = stubContext('webgl2');

      expect(webgl2Supported()).toBe(true);
      expect(webgl2Supported()).toBe(true);

      expect(getContext).toHaveBeenCalledTimes(1);
      expect(getContext).toHaveBeenCalledWith('webgl2');
      expect(loseContext).toHaveBeenCalledTimes(1);
    });

    it('reads a refusal as no WebGL 2, and remembers it', () => {
      const { getContext } = stubContext('none');

      expect(webgl2Supported()).toBe(false);
      expect(webgl2Supported()).toBe(false);
      expect(getContext).toHaveBeenCalledTimes(1);
    });

    it('reads a canvas that throws as no WebGL 2', () => {
      stubContext('throws');

      expect(webgl2Supported()).toBe(false);
    });

    it('asks again once forgotten', () => {
      const { getContext } = stubContext('webgl2');
      webgl2Supported();

      forgetWebgl2Probe();
      webgl2Supported();

      expect(getContext).toHaveBeenCalledTimes(2);
    });
  });
});

describe('TWIN_UNAVAILABLE_COPY', () => {
  it('says a device that refuses WebGL 2 cannot draw the twin, and that the 2D map shows the same', () => {
    expect(TWIN_UNAVAILABLE_COPY['no-webgl2']).toEqual({
      title: "3D view isn't available on this device",
      detail: 'WebGL 2 is off or blocked. The 2D map shows the same incidents, cameras and assets.',
    });
  });

  it('says a lost context did not come back, and that the 2D map shows the same', () => {
    expect(TWIN_UNAVAILABLE_COPY['context-lost']).toEqual({
      title: '3D view stopped working',
      detail:
        'The graphics context was lost and did not come back. The 2D map shows the same incidents, cameras and assets.',
    });
  });
});
