/**
 * Focus went nowhere: the focused element was removed, or nothing had focus. Code that moves focus
 * after something disappeared checks this first, so a move the user made on purpose is kept.
 */
export function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}
