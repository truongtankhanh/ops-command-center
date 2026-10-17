import { act, renderHook } from '@testing-library/react';
import { useLegendOpen } from './useLegendOpen';

const KEY = 'occ.console.mapLegendOpen';

describe('useLegendOpen', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => vi.restoreAllMocks());

  it('is open by default', () => {
    const { result } = renderHook(() => useLegendOpen());

    expect(result.current[0]).toBe(true);
  });

  it('closes on a toggle and writes it for this browser, and opens again on the next', () => {
    const { result } = renderHook(() => useLegendOpen());

    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('false');

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('true');
  });

  it('starts closed for an operator who closed it before', () => {
    localStorage.setItem(KEY, 'false');

    const { result } = renderHook(() => useLegendOpen());

    expect(result.current[0]).toBe(false);
  });

  it('is one preference for every legend: a second one reads what the first wrote', () => {
    const first = renderHook(() => useLegendOpen());
    act(() => first.result.current[1]());

    const second = renderHook(() => useLegendOpen());

    expect(second.result.current[0]).toBe(false);
  });

  it('opens and toggles when storage is blocked, it is just not remembered', () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const { result } = renderHook(() => useLegendOpen());
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());

    expect(result.current[0]).toBe(false);
  });
});
