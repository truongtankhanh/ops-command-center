import { act, renderHook } from '@testing-library/react';
import { getPinDrag, setPinDrag, subscribePinDrag, usePinDrag } from './twinPinDrag';

describe('the pin drag preview (V2-16.7)', () => {
  afterEach(() => setPinDrag(null));

  it('starts with no preview', () => {
    expect(getPinDrag()).toBeNull();
  });

  it('holds the place it was given, as a copy', () => {
    const place = { x: 12, z: -30 };

    setPinDrag(place);

    expect(getPinDrag()).toEqual({ x: 12, z: -30 });
    expect(getPinDrag()).not.toBe(place);
  });

  it('clears with null', () => {
    setPinDrag({ x: 1, z: 2 });

    setPinDrag(null);

    expect(getPinDrag()).toBeNull();
  });

  it('tells a subscriber each time the preview really changes, and not when it stays', () => {
    const heard = vi.fn();
    const stop = subscribePinDrag(heard);

    setPinDrag({ x: 1, z: 2 });
    setPinDrag({ x: 1, z: 2 });
    setPinDrag({ x: 1, z: 3 });
    setPinDrag(null);
    setPinDrag(null);

    expect(heard).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stops telling a subscriber that unsubscribed', () => {
    const heard = vi.fn();
    subscribePinDrag(heard)();

    setPinDrag({ x: 1, z: 2 });

    expect(heard).not.toHaveBeenCalled();
  });

  it('re-renders a component that reads it, only when it changes', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return usePinDrag();
    });
    expect(result.current).toBeNull();
    const before = renders;

    act(() => setPinDrag({ x: 4, z: 5 }));
    expect(result.current).toEqual({ x: 4, z: 5 });
    expect(renders).toBe(before + 1);

    act(() => setPinDrag({ x: 4, z: 5 }));
    expect(renders).toBe(before + 1);

    act(() => setPinDrag(null));
    expect(result.current).toBeNull();
  });
});
