import { RESTORE_MS, watchContext } from './twinContext';

const lose = (target: EventTarget) => {
  const event = new Event('webglcontextlost', { cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const restore = (target: EventTarget) =>
  target.dispatchEvent(new Event('webglcontextrestored', { cancelable: true }));

describe('watchContext', () => {
  let target: EventTarget;
  let onRestore: ReturnType<typeof vi.fn<() => void>>;
  let onFault: ReturnType<typeof vi.fn<() => void>>;
  const watch = (restoreMs?: number) =>
    watchContext(target, {
      onRestore,
      onFault,
      ...(restoreMs === undefined ? {} : { restoreMs }),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
    onRestore = vi.fn<() => void>();
    onFault = vi.fn<() => void>();
  });

  afterEach(() => vi.useRealTimers());

  it('gives the context five seconds, as the ADR says', () => {
    expect(RESTORE_MS).toBe(5000);
  });

  it('prevents the default of a loss, so the browser may restore the context', () => {
    watch();

    expect(lose(target).defaultPrevented).toBe(true);
  });

  it('redraws and raises no fault when the context comes back at 4.9 s', () => {
    watch();
    lose(target);

    vi.advanceTimersByTime(4900);
    restore(target);
    vi.advanceTimersByTime(60_000);

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onFault).not.toHaveBeenCalled();
  });

  it('raises the fault once at 5 s, and not a millisecond before', () => {
    watch();
    lose(target);

    vi.advanceTimersByTime(4999);
    expect(onFault).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFault).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it('is too late at 5 s: a restore after the deadline neither redraws nor undoes the fault', () => {
    watch();
    lose(target);

    vi.advanceTimersByTime(5000);
    restore(target);

    expect(onFault).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('does not extend the deadline when the context is lost again while waiting', () => {
    watch();
    lose(target);
    vi.advanceTimersByTime(3000);

    lose(target);
    vi.advanceTimersByTime(2000);

    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it('starts a new five seconds when it is lost again after a restore', () => {
    watch();
    lose(target);
    vi.advanceTimersByTime(1000);
    restore(target);

    lose(target);
    vi.advanceTimersByTime(4999);
    expect(onFault).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it('ignores a restore that no loss preceded', () => {
    watch();

    restore(target);

    expect(onRestore).not.toHaveBeenCalled();
    expect(onFault).not.toHaveBeenCalled();
  });

  it('honours another deadline', () => {
    watch(1000);
    lose(target);

    vi.advanceTimersByTime(999);
    expect(onFault).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it('stops everything when disposed before the deadline', () => {
    const dispose = watch();
    lose(target);

    dispose();
    vi.advanceTimersByTime(60_000);
    restore(target);
    lose(target);
    vi.advanceTimersByTime(60_000);

    expect(onFault).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
    // The listeners are gone too: a loss after the stop is not prevented here any more.
    expect(lose(target).defaultPrevented).toBe(false);
  });

  it('can be disposed twice, and after the fault', () => {
    const dispose = watch();
    lose(target);
    vi.advanceTimersByTime(5000);

    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
    expect(onFault).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the fault was raised', () => {
    watch();
    lose(target);
    vi.advanceTimersByTime(5000);

    lose(target);
    vi.advanceTimersByTime(5000);

    expect(onFault).toHaveBeenCalledTimes(1);
  });
});
