import type { Logger } from '@nestjs/common';
import { ListenerSet } from './listener-set';

/** A logger that only records `warn`, the one level the set uses. */
function setOver<T>() {
  const warn = jest.fn();
  const set = new ListenerSet<T>({ warn } as unknown as Logger);
  return { set, warn };
}

describe('ListenerSet', () => {
  it('hands every listener the value', () => {
    const { set } = setOver<number>();
    const first = jest.fn();
    const second = jest.fn();
    set.add(first);
    set.add(second);

    set.notify(7);

    expect(first).toHaveBeenCalledWith(7);
    expect(second).toHaveBeenCalledWith(7);
  });

  it('stops calling a listener that unsubscribed, and tolerates a second unsubscribe', () => {
    const { set } = setOver<number>();
    const listener = jest.fn();
    const unsubscribe = set.add(listener);

    unsubscribe();
    unsubscribe();
    set.notify(1);

    expect(listener).not.toHaveBeenCalled();
  });

  it('is not disturbed by a listener that unsubscribes itself while being notified', () => {
    const { set } = setOver<number>();
    const second = jest.fn();
    // Annotated: the arrow refers to the very constant it initialises.
    const unsubscribeFirst: () => void = set.add(() => unsubscribeFirst());
    set.add(second);

    set.notify(1);

    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps notifying after a listener throws, and says so once', () => {
    const { set, warn } = setOver<number>();
    const after = jest.fn();
    set.add(() => {
      throw new Error('first bug');
    });
    set.add(after);

    set.notify(1);
    set.notify(2);

    expect(after).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('first bug'));
  });

  it('catches a listener whose promise rejects, instead of leaving it unhandled', async () => {
    const { set, warn } = setOver<number>();
    set.add(async () => {
      throw new Error('async bug');
    });

    set.notify(1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('async bug'));
  });

  it('reports one failure for the set, whichever way a listener fails', async () => {
    const { set, warn } = setOver<number>();
    set.add(() => {
      throw new Error('sync');
    });
    set.add(async () => {
      throw new Error('async');
    });

    set.notify(1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
