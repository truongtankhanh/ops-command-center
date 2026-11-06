import {
  debugTwinCarried,
  debugTwinRequested,
  forgetDebugTwin,
  readDebugTwin,
  rememberDebugTwin,
} from './twinDebugAddress';

const KEY = 'occ.console.debugTwin';

describe('debugTwinRequested', () => {
  it.each([
    ['?debug=twin', true],
    ['debug=twin', true],
    ['?a=1&debug=twin', true],
    ['?debug=twin&a=1', true],
    ['', false],
    ['?debug', false],
    ['?debug=', false],
    ['?debug=twin2', false],
    ['?debug=twins', false],
    ['?Debug=twin', false],
    ['?debug=Twin', false],
    ['?twin=1', false],
  ])('%j → %s', (search, expected) => {
    expect(debugTwinRequested(search)).toBe(expected);
  });

  it('does not throw on a malformed string', () => {
    expect(debugTwinRequested('?debug=twin&%E0%A4%A')).toBe(true);
    expect(debugTwinRequested('%')).toBe(false);
  });
});

describe('the tab remembers the flag through sign-in (V3-11.8)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('has none until it is told', () => {
    expect(readDebugTwin()).toBe(false);
    expect(debugTwinCarried()).toBe(false);
  });

  it('keeps the flag in this tab, in session storage and not in local storage', () => {
    rememberDebugTwin();

    expect(readDebugTwin()).toBe(true);
    expect(sessionStorage.getItem(KEY)).toBe('1');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reads what is stored only if it is the remembered value', () => {
    sessionStorage.setItem(KEY, 'true');

    expect(readDebugTwin()).toBe(false);
  });

  it('is carried by the address alone', () => {
    history.replaceState(null, '', '/?debug=twin');

    expect(debugTwinCarried()).toBe(true);
  });

  // The sign-in redirect comes back to `/` with a code: the address no longer says `debug=twin`.
  it('survives the redirect that drops the query string', () => {
    history.replaceState(null, '', '/?debug=twin');
    if (debugTwinCarried()) rememberDebugTwin();

    history.replaceState(null, '', '/?code=abc&state=xyz');

    expect(debugTwinCarried()).toBe(true);
  });

  it('survives an error callback too', () => {
    rememberDebugTwin();
    history.replaceState(null, '', '/?error=access_denied&state=xyz');

    expect(debugTwinCarried()).toBe(true);
  });

  it('is not carried at any other address, whatever the tab remembered', () => {
    rememberDebugTwin();

    expect(debugTwinCarried()).toBe(false);
    history.replaceState(null, '', '/?wall=2');
    expect(debugTwinCarried()).toBe(false);
    history.replaceState(null, '', '/?debug=Twin');
    expect(debugTwinCarried()).toBe(false);
    history.replaceState(null, '', '/?code=abc');
    expect(debugTwinCarried()).toBe(false);
    history.replaceState(null, '', '/?state=xyz');
    expect(debugTwinCarried()).toBe(false);
  });

  it('forgets the flag for a tab loaded without it', () => {
    rememberDebugTwin();

    forgetDebugTwin();

    expect(readDebugTwin()).toBe(false);
    history.replaceState(null, '', '/?code=abc&state=xyz');
    expect(debugTwinCarried()).toBe(false);
  });

  it('does not throw where storage is blocked: the address still carries the flag, nothing else does', () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);

    expect(readDebugTwin()).toBe(false);
    expect(() => rememberDebugTwin()).not.toThrow();
    expect(() => forgetDebugTwin()).not.toThrow();
    history.replaceState(null, '', '/?code=abc&state=xyz');
    expect(debugTwinCarried()).toBe(false);
    history.replaceState(null, '', '/?debug=twin');
    expect(debugTwinCarried()).toBe(true);
  });
});
