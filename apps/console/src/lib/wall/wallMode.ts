/*
 * Wall mode (V2-21.2, ADR-0020 "Settled in V2-21.1"): a window opened as a control-room video wall screen. It is a
 * mode of the console, switched on by `?wall=N` (`N`, a positive integer, is the screen's number in "Wall N · view
 * only"), and it is read-only for every role.
 *
 * The sign-in redirect loses the query string: the redirect URI is the origin root, and `signIn()` in
 * `auth/session.ts` replaces the address with its path once the callback is done. So the number is kept in
 * `sessionStorage`, for the tab, which is one wall screen's window, and read again whenever the address has no `wall`.
 * Storage is optional (`.claude/rules/console.md`): where it is blocked the address still works for the page that
 * carried it, and a reload after sign-in is then an ordinary console.
 */

const STORAGE_KEY = 'occ.console.wall';

/** A positive integer with no sign, no sign-like prefix and no fraction; anything else is not a screen number. */
function screenNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const screen = Number(value);
  return Number.isSafeInteger(screen) ? screen : null;
}

/** The screen number in a query string (`?wall=2` is 2), or `null` for no `wall` or one that is not a number. */
export function wallScreenOf(search: string): number | null {
  return screenNumber(new URLSearchParams(search).get('wall'));
}

/** The screen number this tab remembered, or `null`; storage that is missing, blocked or holds anything else reads as none. */
export function readWall(): number | null {
  try {
    return screenNumber(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Remembers the screen number for this tab, so it survives the sign-in redirect. */
export function rememberWall(screen: number): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(screen));
  } catch {
    // Not remembered: the address still opens the wall for this page.
  }
}

/** The screen this window is: the address's `wall` while it has one, else the one the tab remembered, else `null`. */
export function wallScreen(): number | null {
  try {
    const fromAddress = wallScreenOf(location.search);
    if (fromAddress !== null) return fromAddress;
  } catch {
    // No `location`: not a browser page.
  }
  return readWall();
}
