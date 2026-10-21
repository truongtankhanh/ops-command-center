import { act, renderHook } from '@testing-library/react';
import { useWallScale } from './useWallScale';

const scale = () => document.documentElement.style.getPropertyValue('--ui-scale');

function resizeTo(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('useWallScale', () => {
  const original = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: original,
    });
    document.documentElement.style.removeProperty('--ui-scale');
  });

  it("sets the wall's own scale on <html> as soon as it is mounted", () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1920,
    });

    renderHook(() => useWallScale());

    expect(scale()).toBe('1.35');
  });

  it('follows the window when it changes size', () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1920,
    });
    renderHook(() => useWallScale());

    resizeTo(3840);

    expect(scale()).toBe('2.7');
  });

  it("takes the scale away on unmount, so the console's own comes back", () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1920,
    });
    const { unmount } = renderHook(() => useWallScale());

    unmount();

    expect(scale()).toBe('');
    resizeTo(3840);
    expect(scale()).toBe('');
  });
});
