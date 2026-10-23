/*
 * Wall mode (V2-21.2, ADR-0020 "Settled in V2-21.1"): a window opened as a control-room video wall screen. It is a
 * mode of the console, switched on by `?wall=N` (`N`, a positive integer, is the screen's number in "Wall N · view
 * only"), and it is read-only for every role.
 *
 * The sign-in redirect loses the query string: the redirect URI is the origin root, and `signIn()` in
 * `auth/session.ts` replaces the address with its path once the callback is done. So the number is kept in
 * `sessionStorage`, for the tab, which is one wall screen's window, and read again only while the address is that
 * redirect's callback (`code`/`error` and `state`); `main.tsx` forgets it on any other address, so a tab that was a wall
 * once is an ordinary console again when it is opened at the plain address, and `signIn()` puts `?wall=N` back on the
 * address, so a reload stays a wall. Storage is optional (`.claude/rules/console.md`): where it is blocked the address
 * still works for the page that carried it.
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

/** Forgets the screen number, for a tab that is now an ordinary console. */
export function forgetWall(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not forgotten: `wallScreen()` only reads it back on a sign-in callback, which this tab no longer makes.
  }
}

/** Whether the address is the sign-in redirect's callback; the same test as `auth/session.ts`. */
function isSigninCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return (params.has('code') || params.has('error')) && params.has('state');
}

/**
 * The screen this window is: the address's `wall` while it has one, else, on the sign-in callback only, the one the tab
 * remembered, else `null`. Any other address without `wall` is a console, whatever an earlier page of the tab was.
 */
export function wallScreen(): number | null {
  try {
    const fromAddress = wallScreenOf(location.search);
    if (fromAddress !== null) return fromAddress;
    return isSigninCallback(location.search) ? readWall() : null;
  } catch {
    // No `location`: not a browser page.
    return null;
  }
}
