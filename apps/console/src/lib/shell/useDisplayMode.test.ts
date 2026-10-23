import { act, renderHook } from '@testing-library/react';
import { stubViewportWidth } from '../test-utils';
import { useDisplayMode } from './useDisplayMode';

afterEach(() => vi.unstubAllGlobals());

describe('useDisplayMode', () => {
  it.each([
    [3840, 'wall-4k'],
    [1920, 'wall'],
    [1440, 'laptop'],
    [1024, 'tablet'],
    [600, 'phone'],
  ] as const)('reads %i px as %s', (width, mode) => {
    stubViewportWidth(width);

    const { result } = renderHook(() => useDisplayMode());

    expect(result.current).toBe(mode);
  });

  // Inclusive, like the CSS queries; a 4K width also matches `wall` and a phone width `tablet`,
  // so these also pin the order the modes are tried in.
  it.each([
    [3200, 'wall-4k'],
    [3199, 'wall'],
    [1920, 'wall'],
    [1919, 'laptop'],
    [1101, 'laptop'],
    [1100, 'tablet'],
    [721, 'tablet'],
    [720, 'phone'],
  ] as const)('puts the %i px edge in %s', (width, mode) => {
    stubViewportWidth(width);

    const { result } = renderHook(() => useDisplayMode());

    expect(result.current).toBe(mode);
  });

  it('lays out as a laptop where the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);

    const { result } = renderHook(() => useDisplayMode());

    expect(result.current).toBe('laptop');
  });

  it('follows the window across a breakpoint', () => {
    const viewport = stubViewportWidth(1440);
    const { result } = renderHook(() => useDisplayMode());
    expect(result.current).toBe('laptop');

    act(() => viewport.resize(1920));
    expect(result.current).toBe('wall');

    act(() => viewport.resize(3840));
    expect(result.current).toBe('wall-4k');

    act(() => viewport.resize(600));
    expect(result.current).toBe('phone');
  });

  it('does not re-render on a resize that crosses no breakpoint', () => {
    const viewport = stubViewportWidth(1440);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useDisplayMode();
    });
    const before = renders;

    act(() => viewport.resize(1500));

    expect(renders).toBe(before);
    expect(result.current).toBe('laptop');
  });

  it('stops listening when unmounted', () => {
    const viewport = stubViewportWidth(1440);
    const { unmount } = renderHook(() => useDisplayMode());
    // One listener per query: wall-4k, wall, phone, tablet.
    expect(viewport.listenerCount()).toBe(4);

    unmount();

    expect(viewport.listenerCount()).toBe(0);
  });
});
