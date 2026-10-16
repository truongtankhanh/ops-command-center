import {
  forgetWebgl2Probe,
  previewGateOpen,
  TWIN_UNAVAILABLE_COPY,
  twinCapability,
  webgl2Supported,
} from './twinCapability';

const KEY = 'occ.console.twinPreview';

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
    sessionStorage.clear();
    history.replaceState(null, '', '/');
    forgetWebgl2Probe();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    forgetWebgl2Probe();
  });

  // Vitest runs with MODE `test`, so the gate is closed here as it is in a production build.
  it('says the twin is not offered while the preview gate is closed', () => {
    expect(twinCapability()).toEqual({ available: false, reason: 'not-built' });
  });

  describe('the preview gate', () => {
    it('is closed in a production-like build', () => {
      expect(previewGateOpen()).toBe(false);
    });

    it('is open in a development build', () => {
      vi.stubEnv('MODE', 'development');

      expect(previewGateOpen()).toBe(true);
    });

    it('opens with ?twin=1 and stays open for the tab', () => {
      history.replaceState(null, '', '/?twin=1');

      expect(previewGateOpen()).toBe(true);
      expect(sessionStorage.getItem(KEY)).toBe('1');

      history.replaceState(null, '', '/');
      expect(previewGateOpen()).toBe(true);
    });

    it('stays closed for another value of the parameter', () => {
      history.replaceState(null, '', '/?twin=0');

      expect(previewGateOpen()).toBe(false);
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it('does not throw when storage is blocked: the URL still opens it, nothing else does', () => {
      const blocked = () => {
        throw new Error('Storage is disabled');
      };
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);

      expect(previewGateOpen()).toBe(false);
      history.replaceState(null, '', '/?twin=1');
      expect(previewGateOpen()).toBe(true);
    });
  });

  describe('the order of the reasons', () => {
    it('puts a closed gate before everything and probes nothing', () => {
      const { getContext } = stubContext('webgl2');

      expect(twinCapability('context-lost')).toEqual({ available: false, reason: 'not-built' });
      expect(getContext).not.toHaveBeenCalled();
    });

    it('puts a missing WebGL 2 before a fault', () => {
      vi.stubEnv('MODE', 'development');
      stubContext('none');

      expect(twinCapability('context-lost')).toEqual({ available: false, reason: 'no-webgl2' });
    });

    it('reports a fault where everything else is fine', () => {
      vi.stubEnv('MODE', 'development');
      stubContext('webgl2');

      expect(twinCapability('context-lost')).toEqual({ available: false, reason: 'context-lost' });
    });

    it('is available with the gate open, WebGL 2 and no fault', () => {
      vi.stubEnv('MODE', 'development');
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

  it('says a lost context did not come back, and that the 2D map shows the same', () => {
    expect(TWIN_UNAVAILABLE_COPY['context-lost']).toEqual({
      title: '3D view stopped working',
      detail:
        'The graphics context was lost and did not come back. The 2D map shows the same incidents, cameras and assets.',
    });
  });
});
