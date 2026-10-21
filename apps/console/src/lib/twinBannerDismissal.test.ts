import { readTwinBannerDismissed, writeTwinBannerDismissed } from './twinBannerDismissal';

const KEY = 'occ.console.twinBannerDismissed';

beforeEach(() => sessionStorage.clear());

afterEach(() => vi.restoreAllMocks());

describe('the twin banner dismissal', () => {
  it('is not dismissed until it is written', () => {
    expect(readTwinBannerDismissed('no-webgl2')).toBe(false);
  });

  it('reads back what it wrote, in this tab only', () => {
    writeTwinBannerDismissed('no-webgl2');

    expect(readTwinBannerDismissed('no-webgl2')).toBe(true);
    expect(sessionStorage.getItem(KEY)).toBe('no-webgl2');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is dismissed for that reason only, so another reason shows again', () => {
    writeTwinBannerDismissed('no-webgl2');

    expect(readTwinBannerDismissed('context-lost')).toBe(false);
  });

  it('is not dismissed, and remembering does not throw, when storage is blocked', () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);

    expect(readTwinBannerDismissed('no-webgl2')).toBe(false);
    expect(() => writeTwinBannerDismissed('no-webgl2')).not.toThrow();
  });
});
