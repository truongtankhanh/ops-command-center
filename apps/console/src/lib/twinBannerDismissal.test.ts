import { readTwinBannerDismissed, writeTwinBannerDismissed } from './twinBannerDismissal';

const KEY = 'occ.console.twinBannerDismissed';

beforeEach(() => sessionStorage.clear());

afterEach(() => vi.restoreAllMocks());

describe('the twin banner dismissal', () => {
  it('is not dismissed until it is written', () => {
    expect(readTwinBannerDismissed('not-built')).toBe(false);
  });

  it('reads back what it wrote, in this tab only', () => {
    writeTwinBannerDismissed('not-built');

    expect(readTwinBannerDismissed('not-built')).toBe(true);
    expect(sessionStorage.getItem(KEY)).toBe('not-built');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is dismissed for that reason only, so another reason shows again', () => {
    writeTwinBannerDismissed('not-built');

    expect(readTwinBannerDismissed('no-webgl2')).toBe(false);
  });

  it('is not dismissed, and remembering does not throw, when storage is blocked', () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);

    expect(readTwinBannerDismissed('not-built')).toBe(false);
    expect(() => writeTwinBannerDismissed('not-built')).not.toThrow();
  });
});
