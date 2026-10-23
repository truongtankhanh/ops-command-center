import { renderHook } from '@testing-library/react';
import { useStopPickingOnEscape } from './useStopPickingOnEscape';

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe('useStopPickingOnEscape (V2-16.7)', () => {
  it('calls stop once on Escape and stops the event, so nothing below the document hears it', () => {
    const stop = vi.fn();
    const heardBelow = vi.fn();
    document.body.addEventListener('keydown', heardBelow);
    renderHook(() => useStopPickingOnEscape(true, stop));

    const event = press('Escape');

    expect(stop).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(heardBelow).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', heardBelow);
  });

  it('hears Escape pressed in a field inside a sheet, before the sheet does', () => {
    const stop = vi.fn();
    const sheet = document.createElement('div');
    const field = document.createElement('input');
    sheet.append(field);
    document.body.append(sheet);
    const sheetHeard = vi.fn();
    sheet.addEventListener('keydown', sheetHeard);
    renderHook(() => useStopPickingOnEscape(true, stop));

    press('Escape', {}, field);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(sheetHeard).not.toHaveBeenCalled();
    sheet.remove();
  });

  it('leaves every other key alone', () => {
    const stop = vi.fn();
    const heardBelow = vi.fn();
    document.body.addEventListener('keydown', heardBelow);
    renderHook(() => useStopPickingOnEscape(true, stop));

    const event = press('Enter');

    expect(stop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(heardBelow).toHaveBeenCalledTimes(1);
    document.body.removeEventListener('keydown', heardBelow);
  });

  it('leaves an Escape that ends an IME composition alone', () => {
    const stop = vi.fn();
    renderHook(() => useStopPickingOnEscape(true, stop));

    press('Escape', { isComposing: true });

    expect(stop).not.toHaveBeenCalled();
  });

  it('does nothing, and stops nothing, when it is not enabled', () => {
    const stop = vi.fn();
    const heardBelow = vi.fn();
    document.body.addEventListener('keydown', heardBelow);
    renderHook(() => useStopPickingOnEscape(false, stop));

    const event = press('Escape');

    expect(stop).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(heardBelow).toHaveBeenCalledTimes(1);
    document.body.removeEventListener('keydown', heardBelow);
  });

  it('follows `enabled`: it listens when it turns on and stops when it turns off', () => {
    const stop = vi.fn();
    const { rerender } = renderHook(({ on }) => useStopPickingOnEscape(on, stop), {
      initialProps: { on: false },
    });
    press('Escape');
    expect(stop).not.toHaveBeenCalled();

    rerender({ on: true });
    press('Escape');
    expect(stop).toHaveBeenCalledTimes(1);

    rerender({ on: false });
    press('Escape');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('calls the latest stop', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ stop }) => useStopPickingOnEscape(true, stop), {
      initialProps: { stop: first },
    });

    rerender({ stop: second });
    press('Escape');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops listening when its component goes', () => {
    const stop = vi.fn();
    const { unmount } = renderHook(() => useStopPickingOnEscape(true, stop));

    unmount();
    press('Escape');

    expect(stop).not.toHaveBeenCalled();
  });
});
