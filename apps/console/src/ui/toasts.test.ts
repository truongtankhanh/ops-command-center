import { resetStore } from '../test-utils';
import { dismissToast, hasToast, showToast, type Toast, useToasts } from './toasts';

const toasts = () => useToasts.getState().toasts;
const titles = () => toasts().map((toast) => toast.title);
const toast = (title: string, extra: Partial<Omit<Toast, 'id' | 'title'>> = {}) => ({
  title,
  ...extra,
});

describe('toasts', () => {
  // A module-level store: every case starts from no toasts. Ids keep counting up across cases.
  beforeEach(() => resetStore(useToasts));

  it('appends toasts in order, each with a new id', () => {
    showToast(toast('A'));
    showToast(toast('B'));

    const [a, b] = toasts();
    expect(titles()).toEqual(['A', 'B']);
    expect(b!.id).toBeGreaterThan(a!.id);
  });

  it('dismisses only the given toast', () => {
    showToast(toast('A'));
    showToast(toast('B'));

    dismissToast(toasts()[0]!.id);

    expect(titles()).toEqual(['B']);
  });

  it('replaces the toast with the same key in place, with a new id', () => {
    showToast(toast('A'));
    showToast(toast('Reported INC-1', { key: 'incident-1' }));
    showToast(toast('C'));
    const [a, keyed, c] = toasts();

    showToast(toast('New critical', { key: 'incident-1', urgent: true }));

    expect(titles()).toEqual(['A', 'New critical', 'C']);
    expect(toasts()[1]).toMatchObject({ key: 'incident-1', urgent: true });
    expect(toasts()[1]!.id).not.toBe(keyed!.id);
    expect(toasts()[0]!.id).toBe(a!.id);
    expect(toasts()[2]!.id).toBe(c!.id);
  });

  it('never replaces a toast without a key', () => {
    showToast(toast('Same'));
    showToast(toast('Same'));

    expect(titles()).toEqual(['Same', 'Same']);
  });

  it('tells whether a toast about a key is shown', () => {
    showToast(toast('A', { key: 'incident-1' }));

    expect(hasToast('incident-1')).toBe(true);
    expect(hasToast('incident-2')).toBe(false);

    dismissToast(toasts()[0]!.id);

    expect(hasToast('incident-1')).toBe(false);
  });

  describe('at most three', () => {
    it('drops the oldest toast when a fourth arrives', () => {
      for (const title of ['A', 'B', 'C', 'D']) showToast(toast(title));

      expect(titles()).toEqual(['B', 'C', 'D']);
    });

    // A burst of other toasts must never push a critical incident's toast out.
    it('keeps an urgent toast and drops the oldest normal one', () => {
      showToast(toast('Critical', { urgent: true }));
      for (const title of ['A', 'B', 'C']) showToast(toast(title));

      expect(titles()).toEqual(['Critical', 'B', 'C']);
    });

    it('drops the oldest urgent toast when every toast is urgent', () => {
      for (const title of ['A', 'B', 'C', 'D']) showToast(toast(title, { urgent: true }));

      expect(titles()).toEqual(['B', 'C', 'D']);
    });

    it('drops nothing when a toast is replaced by key', () => {
      showToast(toast('A', { key: 'a' }));
      showToast(toast('B'));
      showToast(toast('C'));

      showToast(toast('A again', { key: 'a' }));

      expect(titles()).toEqual(['A again', 'B', 'C']);
    });
  });
});
