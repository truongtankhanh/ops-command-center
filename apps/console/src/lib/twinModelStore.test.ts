import { act } from '@testing-library/react';
import type { ClassProgress } from './twinLoadQueue';
import { useTwinModelStore } from './twinModelStore';

const loading = (loaded: number, total = 1000): ClassProgress => ({
  state: 'loading',
  loaded,
  total,
});

describe('useTwinModelStore', () => {
  afterEach(() => act(() => useTwinModelStore.getState().reset()));

  it('starts with no class', () => {
    expect(useTwinModelStore.getState().byClass).toEqual({});
  });

  it('holds the progress of a class and leaves the others alone', () => {
    act(() => {
      useTwinModelStore.getState().report('cooling_tower', loading(100));
      useTwinModelStore.getState().report('standby_generator', loading(5));
      useTwinModelStore.getState().report('cooling_tower', loading(300));
    });

    expect(useTwinModelStore.getState().byClass).toEqual({
      cooling_tower: loading(300),
      standby_generator: loading(5),
    });
  });

  it('does not notify for a progress equal to the one it holds', () => {
    act(() => useTwinModelStore.getState().report('cooling_tower', loading(100)));
    const listener = vi.fn();
    const stop = useTwinModelStore.subscribe(listener);

    act(() => useTwinModelStore.getState().report('cooling_tower', loading(100)));
    expect(listener).not.toHaveBeenCalled();

    act(() => useTwinModelStore.getState().report('cooling_tower', loading(101)));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('forgets every class on reset, and says nothing when there was none', () => {
    act(() => useTwinModelStore.getState().report('cooling_tower', loading(1)));
    act(() => useTwinModelStore.getState().reset());
    expect(useTwinModelStore.getState().byClass).toEqual({});

    const listener = vi.fn();
    const stop = useTwinModelStore.subscribe(listener);
    act(() => useTwinModelStore.getState().reset());
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
