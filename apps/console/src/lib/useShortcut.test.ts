import { renderHook } from '@testing-library/react';
import { isShortcut, useShortcut } from './useShortcut';

/** An element in the page, so `closest()` sees its ancestors. */
function element(
  tag: string,
  attributes: Record<string, string> = {},
  parent: Element = document.body,
) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.append(node);
  return node;
}

afterEach(() => document.body.replaceChildren());

describe('isShortcut', () => {
  /** A constructed event has no target until dispatched, and `isShortcut` reads it. */
  function keydown(init: KeyboardEventInit = {}, target: EventTarget = document.body) {
    const event = new KeyboardEvent('keydown', {
      key: 'n',
      bubbles: true,
      cancelable: true,
      ...init,
    });
    Object.defineProperty(event, 'target', { value: target });
    return event;
  }

  it.each(['n', 'N'])('matches %s, whatever the case', (key) => {
    expect(isShortcut(keydown({ key }), 'n')).toBe(true);
  });

  it('matches on a focused button, such as a feed row', () => {
    expect(isShortcut(keydown({}, element('button')), 'n')).toBe(true);
  });

  it('ignores another key', () => {
    expect(isShortcut(keydown({ key: 'm' }), 'n')).toBe(false);
  });

  it.each(['ctrlKey', 'altKey', 'metaKey'] as const)(
    'leaves %s combinations to the browser',
    (modifier) => {
      expect(isShortcut(keydown({ [modifier]: true }), 'n')).toBe(false);
    },
  );

  it('ignores auto-repeat', () => {
    expect(isShortcut(keydown({ repeat: true }), 'n')).toBe(false);
  });

  it('ignores a key that ends an IME composition', () => {
    expect(isShortcut(keydown({ isComposing: true }), 'n')).toBe(false);
  });

  it('ignores a key something else already handled', () => {
    const event = keydown();
    event.preventDefault();

    expect(isShortcut(event, 'n')).toBe(false);
  });

  it.each([
    ['an input', () => element('input')],
    ['a textarea', () => element('textarea')],
    ['a select', () => element('select')],
    ['an editable region', () => element('span', {}, element('div', { contenteditable: 'true' }))],
  ])('ignores keys typed into %s', (_label, target) => {
    expect(isShortcut(keydown({}, target()), 'n')).toBe(false);
  });

  it('treats contenteditable=false as not editable', () => {
    const target = element('span', {}, element('div', { contenteditable: 'false' }));

    expect(isShortcut(keydown({}, target), 'n')).toBe(true);
  });
});

describe('useShortcut', () => {
  const handler = vi.fn();

  /** Dispatched for real: it bubbles to the window listener with a real target. */
  function press(key: string, target: EventTarget = document.body) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  function renderShortcut(enabled = true) {
    return renderHook((props: { enabled: boolean }) => useShortcut('n', handler, props.enabled), {
      initialProps: { enabled },
    });
  }

  beforeEach(() => handler.mockReset());

  it('runs the handler once and claims the key', () => {
    renderShortcut();

    const event = press('n');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves other keys alone', () => {
    renderShortcut();

    const event = press('m');

    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets a text field keep the letter', () => {
    renderShortcut();

    const event = press('n', element('input'));

    expect(handler).not.toHaveBeenCalled();
    // Not prevented, so typing "n" still types it.
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing while disabled', () => {
    renderShortcut(false);

    press('n');

    expect(handler).not.toHaveBeenCalled();
  });

  it('stops listening once disabled', () => {
    const { rerender } = renderShortcut();

    rerender({ enabled: false });
    press('n');

    expect(handler).not.toHaveBeenCalled();
  });

  it('stops listening on unmount', () => {
    const { unmount } = renderShortcut();

    unmount();
    press('n');

    expect(handler).not.toHaveBeenCalled();
  });
});
