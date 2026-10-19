import {
  createPendingPick,
  lastPick,
  onPick,
  type PickRequester,
  publishPick,
  registerPicker,
  requestPick,
} from './twinPicker';
import type { PickRef } from './twinPicking';

const building: PickRef = { kind: 'building', id: 'BLD-DC' };
const asset: PickRef = { kind: 'asset', id: 'CT-01' };

describe('twinPicker', () => {
  const requester = () => ({ request: vi.fn<PickRequester['request']>() });
  let unregister = () => {};

  afterEach(() => {
    unregister();
    publishPick(null);
  });

  it('does nothing without a canvas', () => {
    expect(() => requestPick({ x: 1, y: 2 })).not.toThrow();
  });

  it('passes a request to the registered canvas', () => {
    const canvas = requester();
    unregister = registerPicker(canvas);

    requestPick({ x: 10, y: 20 });

    // The completion is the second argument, `undefined` when the caller gave none.
    expect(canvas.request).toHaveBeenCalledWith({ x: 10, y: 20 }, undefined);
  });

  it('passes the completion on with the point, and never calls it itself', () => {
    const canvas = requester();
    unregister = registerPicker(canvas);
    const done = vi.fn();

    requestPick({ x: 3, y: 4 }, done);

    expect(canvas.request).toHaveBeenCalledWith({ x: 3, y: 4 }, done);
    expect(done).not.toHaveBeenCalled();
  });

  it('does not call a completion for a request no canvas heard', () => {
    const done = vi.fn();

    requestPick({ x: 3, y: 4 }, done);

    expect(done).not.toHaveBeenCalled();
  });

  it('stops passing requests once the canvas is unregistered', () => {
    const canvas = requester();
    registerPicker(canvas)();

    requestPick({ x: 10, y: 20 });

    expect(canvas.request).not.toHaveBeenCalled();
  });

  it('leaves a newer canvas in place when an older one is unregistered late', () => {
    const older = requester();
    const newer = requester();
    const removeOlder = registerPicker(older);
    unregister = registerPicker(newer);

    removeOlder();
    requestPick({ x: 1, y: 1 });

    expect(newer.request).toHaveBeenCalledTimes(1);
    expect(older.request).not.toHaveBeenCalled();
  });

  it('forgets the last pick when its canvas goes', () => {
    const remove = registerPicker(requester());
    publishPick(asset);

    remove();

    expect(lastPick()).toBeNull();
  });

  describe('the result', () => {
    it('tells a listener each time the winner changes, and not when it stays', () => {
      const heard = vi.fn();
      const stop = onPick(heard);

      publishPick(building);
      publishPick({ ...building });
      publishPick(asset);
      publishPick(null);
      publishPick(null);

      expect(heard.mock.calls).toEqual([[building], [asset], [null]]);
      stop();
    });

    it('tells apart two parts with the same node name in different assets', () => {
      const heard = vi.fn();
      const stop = onPick(heard);

      publishPick({ kind: 'part', id: 'Valve', assetCode: 'CT-01' });
      publishPick({ kind: 'part', id: 'Valve', assetCode: 'CT-02' });

      expect(heard).toHaveBeenCalledTimes(2);
      stop();
    });

    it('keeps the latest winner for a reader that was not listening', () => {
      publishPick(asset);

      expect(lastPick()).toEqual(asset);
    });

    it('stops telling a listener that unsubscribed', () => {
      const heard = vi.fn();
      onPick(heard)();

      publishPick(building);

      expect(heard).not.toHaveBeenCalled();
    });
  });
});

describe('createPendingPick', () => {
  it('has nothing to take before a request, and nothing after taking', () => {
    const pending = createPendingPick();
    expect(pending.take()).toBeNull();

    pending.request({ x: 1, y: 1 });
    expect(pending.take()).not.toBeNull();

    expect(pending.take()).toBeNull();
  });

  it('keeps only the latest point', () => {
    const pending = createPendingPick();

    pending.request({ x: 1, y: 1 });
    pending.request({ x: 5, y: 6 });

    expect(pending.take()?.point).toEqual({ x: 5, y: 6 });
  });

  it('keeps the completions of every request, in order, including replaced ones', () => {
    const pending = createPendingPick();
    const first = vi.fn();
    const second = vi.fn();

    pending.request({ x: 1, y: 1 }, first);
    pending.request({ x: 2, y: 2 });
    pending.request({ x: 3, y: 3 }, second);

    expect(pending.take()?.callbacks).toEqual([first, second]);
  });

  it('starts again after a take', () => {
    const pending = createPendingPick();
    const old = vi.fn();
    pending.request({ x: 1, y: 1 }, old);
    pending.take();

    pending.request({ x: 2, y: 2 });

    expect(pending.take()?.callbacks).toEqual([]);
  });
});
