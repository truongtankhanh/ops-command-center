import { act, renderHook } from '@testing-library/react';
import { NO_HOVER } from '../lib/twin-core/twinHover';
import { useConsole } from '../store';
import { resetStore } from '../test-utils';
import { useHoverRef } from './useHoverRef';

/* `useThree` is replaced by a fake canvas state whose `invalidate` a test can count. */
const canvas = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock('@react-three/fiber', () => ({
  useThree: (select: (state: { invalidate: () => void }) => unknown) => select(canvas),
}));

describe('useHoverRef', () => {
  beforeEach(() => {
    canvas.invalidate.mockClear();
    resetStore(useConsole);
  });

  it('starts empty and asks for no frame when nothing is hovered', () => {
    const { result } = renderHook(() => useHoverRef());

    expect(result.current.current).toBe(NO_HOVER);
    expect(canvas.invalidate).not.toHaveBeenCalled();
  });

  it('holds a hover that was already there, and asks for a frame', () => {
    act(() => useConsole.getState().hoverAsset('CT-01'));

    const { result } = renderHook(() => useHoverRef());

    expect(result.current.current).toEqual({ asset: 'CT-01', part: null });
    expect(canvas.invalidate).toHaveBeenCalledTimes(1);
  });

  it('follows the hovered asset, with a new object each time, and asks for a frame', () => {
    const { result } = renderHook(() => useHoverRef());

    act(() => useConsole.getState().hoverAsset('CT-01'));
    const first = result.current.current;
    expect(first).toEqual({ asset: 'CT-01', part: null });
    expect(canvas.invalidate).toHaveBeenCalledTimes(1);

    act(() => useConsole.getState().hoverAsset('CT-02'));
    expect(result.current.current).toEqual({ asset: 'CT-02', part: null });
    expect(result.current.current).not.toBe(first);
    expect(canvas.invalidate).toHaveBeenCalledTimes(2);

    act(() => useConsole.getState().hoverAsset(null));
    expect(result.current.current).toBe(NO_HOVER);
    expect(canvas.invalidate).toHaveBeenCalledTimes(3);
  });

  it('follows the hovered part together with its asset', () => {
    const { result } = renderHook(() => useHoverRef());

    act(() => {
      useConsole.getState().hoverAsset('CT-01');
      useConsole.getState().hoverPart('FanBlade');
    });

    expect(result.current.current).toEqual({ asset: 'CT-01', part: 'FanBlade' });
  });

  it('ignores a change of anything else in the store', () => {
    const { result } = renderHook(() => useHoverRef());
    act(() => useConsole.getState().hoverAsset('CT-01'));
    const before = result.current.current;
    canvas.invalidate.mockClear();

    act(() => useConsole.getState().setAssetFilter('faults'));

    expect(result.current.current).toBe(before);
    expect(canvas.invalidate).not.toHaveBeenCalled();
  });

  it('does not ask again for a hover that is the same', () => {
    const { result } = renderHook(() => useHoverRef());
    act(() => useConsole.getState().hoverAsset('CT-01'));
    canvas.invalidate.mockClear();
    const before = result.current.current;

    act(() => useConsole.getState().hoverAsset('CT-01'));

    expect(result.current.current).toBe(before);
    expect(canvas.invalidate).not.toHaveBeenCalled();
  });

  it('stops listening and forgets the hover when it goes', () => {
    const { result, unmount } = renderHook(() => useHoverRef());
    act(() => useConsole.getState().hoverAsset('CT-01'));
    canvas.invalidate.mockClear();

    unmount();
    act(() => useConsole.getState().hoverAsset('CT-02'));

    expect(result.current.current).toBe(NO_HOVER);
    expect(canvas.invalidate).not.toHaveBeenCalled();
  });
});
