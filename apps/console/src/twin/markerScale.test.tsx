import { act, renderHook } from '@testing-library/react';
import { useWallMarkerScale } from './markerScale';

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

describe('useWallMarkerScale', () => {
  const width = window.innerWidth;

  afterEach(() => setWidth(width));

  it('is 1 outside a wall, whatever the window', () => {
    setWidth(3840);

    const { result } = renderHook(() => useWallMarkerScale(false));

    expect(result.current).toBe(1);
  });

  it("is the wall's own scale on a wall: 1.35 at 1920 px", () => {
    setWidth(1920);

    const { result } = renderHook(() => useWallMarkerScale(true));

    expect(result.current).toBe(1.35);
  });

  it('follows the window as it changes, and stops listening with the stage', () => {
    setWidth(1920);
    const { result, unmount } = renderHook(() => useWallMarkerScale(true));

    act(() => {
      setWidth(3840);
      window.dispatchEvent(new Event('resize'));
    });

    // The same picture at twice the size.
    expect(result.current).toBe(2.7);

    const remove = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    remove.mockRestore();
  });

  it('does not listen to the window outside a wall', () => {
    const add = vi.spyOn(window, 'addEventListener');

    renderHook(() => useWallMarkerScale(false));

    expect(add).not.toHaveBeenCalledWith('resize', expect.any(Function));
    add.mockRestore();
  });
});
