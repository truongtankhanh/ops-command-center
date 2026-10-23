import { forgetWall, readWall, rememberWall, wallScreen, wallScreenOf } from './wallMode';

const KEY = 'occ.console.wall';

describe('wallScreenOf', () => {
  it('reads a positive integer', () => {
    expect(wallScreenOf('?wall=1')).toBe(1);
    expect(wallScreenOf('?wall=12')).toBe(12);
    expect(wallScreenOf('?debug=twin&wall=3')).toBe(3);
  });

  it.each([
    '',
    '?',
    '?wall',
    '?wall=',
    '?wall=0',
    '?wall=-1',
    '?wall=x',
    '?wall=1.5',
    '?wall=01',
    '?wall=+2',
  ])('is not a wall for %j', (search) => {
    expect(wallScreenOf(search)).toBeNull();
  });

  it('is not a wall for a number too large to be one', () => {
    expect(wallScreenOf(`?wall=${'9'.repeat(20)}`)).toBeNull();
  });
});

describe('the tab remembers its screen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });

  afterEach(() => vi.restoreAllMocks());

  it('has none until it is told', () => {
    expect(readWall()).toBeNull();
    expect(wallScreen()).toBeNull();
  });

  it('keeps the number in this tab, in session storage and not in local storage', () => {
    rememberWall(2);

    expect(readWall()).toBe(2);
    expect(sessionStorage.getItem(KEY)).toBe('2');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reads what is stored only if it is a screen number', () => {
    sessionStorage.setItem(KEY, 'banana');

    expect(readWall()).toBeNull();
  });

  // The sign-in redirect comes back to `/` with a code: the address no longer says `wall`.
  it('survives the redirect that drops the query string', () => {
    history.replaceState(null, '', '/?wall=2');
    rememberWall(wallScreen()!);

    history.replaceState(null, '', '/?code=abc&state=xyz');

    expect(wallScreen()).toBe(2);
  });

  it('prefers the address to what the tab remembered', () => {
    rememberWall(1);
    history.replaceState(null, '', '/?wall=3');

    expect(wallScreen()).toBe(3);
  });

  it('keeps what the tab remembered on the callback when the address has a value that is not a number', () => {
    rememberWall(4);
    history.replaceState(null, '', '/?wall=x&code=abc&state=xyz');

    expect(wallScreen()).toBe(4);
  });

  it('keeps what the tab remembered on an error callback too', () => {
    rememberWall(2);
    history.replaceState(null, '', '/?error=access_denied&state=xyz');

    expect(wallScreen()).toBe(2);
  });

  // The bug: a tab that was a wall once stayed one at the plain address, and the console could not be entered.
  it('is a console at a plain address, whatever the tab remembered', () => {
    rememberWall(4);

    expect(wallScreen()).toBeNull();
    history.replaceState(null, '', '/?wall=x');
    expect(wallScreen()).toBeNull();
    history.replaceState(null, '', '/?code=abc');
    expect(wallScreen()).toBeNull();
  });

  it('forgets the screen for a tab that is a console again', () => {
    rememberWall(2);

    forgetWall();

    expect(readWall()).toBeNull();
    history.replaceState(null, '', '/?code=abc&state=xyz');
    expect(wallScreen()).toBeNull();
  });

  it('does not throw where storage is blocked: the address still opens the wall, nothing else does', () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);

    expect(readWall()).toBeNull();
    expect(() => rememberWall(2)).not.toThrow();
    expect(() => forgetWall()).not.toThrow();
    expect(wallScreen()).toBeNull();
    history.replaceState(null, '', '/?wall=2');
    expect(wallScreen()).toBe(2);
  });
});
