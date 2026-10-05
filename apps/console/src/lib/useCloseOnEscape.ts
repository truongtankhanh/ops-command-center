import { useEffect } from 'react';

/**
 * Calls `close` when Escape is pressed, unless `keepOpen` — while the panel holds text that
 * closing would throw away, Escape does nothing and only Close / Cancel discard it. An Escape that
 * ends an IME composition (e.g. Vietnamese input) is not a request to close.
 */
export function useCloseOnEscape(close: () => void, keepOpen = false): void {
  useEffect(() => {
    if (keepOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, keepOpen]);
}
