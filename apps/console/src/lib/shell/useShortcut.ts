import { useEffect } from 'react';
import { useConsole } from '../store';

/** Elements where a letter key types text (or picks an option) instead of running a command. */
function takesKeys(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    // `closest`, not `isContentEditable`: it also covers nested elements, and jsdom implements it.
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/**
 * Whether a key press is the single-key shortcut `key` (matched case-insensitively). Following the
 * brief, shortcuts are ignored while focus is in a text field, with Ctrl / Alt / Meta held (those
 * are the browser's and the OS's), on auto-repeat, during IME composition (e.g. Vietnamese input),
 * and when something else already handled the key.
 */
export function isShortcut(event: KeyboardEvent, key: string): boolean {
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.repeat &&
    !event.isComposing &&
    !event.defaultPrevented &&
    !takesKeys(event.target)
  );
}

/**
 * Runs `handler` when the single-key shortcut `key` is pressed anywhere in the console, while
 * `enabled` and while single-key shortcuts are on (`useConsole.keyboardShortcuts`, WCAG 2.1.4).
 * Pass a stable `handler` (a store action or a `useCallback`), so the listener is not re-added on
 * every render. Pair it with a visible hint and `aria-keyshortcuts` on the control it triggers
 * (`Button`'s `shortcut` prop), shown only while the key works, and only enable it while that
 * control is available.
 */
export function useShortcut(key: string, handler: () => void, enabled: boolean): void {
  const shortcutsOn = useConsole((s) => s.keyboardShortcuts);
  const active = enabled && shortcutsOn;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcut(event, key)) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, active]);
}
