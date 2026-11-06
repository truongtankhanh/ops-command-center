/*
 * The developer HUD's address switch, `?debug=twin` (V2-19.1), and how it survives sign-in (V3-11.8).
 *
 * Tokens are kept in memory (ADR-0010), so every page load goes through Keycloak, whose redirect URI is the origin root;
 * `signIn()` in `auth/session.ts` then replaces the address with its path. The flag is carried across that redirect the
 * way a video wall carries its screen number (`lib/wall/wallMode.ts`, V2-21.2): `main.tsx` remembers it for the tab, in
 * `sessionStorage`, while the address has it and forgets it on any other address but the redirect's callback; the
 * callback reads it back and `signIn()` puts it on the address again. The address stays the switch: storage only bridges
 * the redirect. Storage is optional (`.claude/rules/console.md`): where it is blocked the flag works for the page that
 * carried it and is lost through sign-in, as before V3-11.8.
 *
 * This module is in the entry chunk of every build (`main.tsx` and `auth/session.ts` import it); the HUD itself is not,
 * because its other gate, a literal `import.meta.env.MODE === 'development'` where each piece is imported (ADR-0020
 * "Settled in V2-19.1"), is untouched. `scripts/chunk-budget.ts` fails a production build that contains the text
 * `debug=twin`, so no code or string here spells it as one token: the parameter's name and value stay apart.
 */

const STORAGE_KEY = 'occ.console.debugTwin';
const REMEMBERED = '1';

/**
 * Whether the address asks for the HUD: a `debug` parameter equal to `twin`. Only half of the gate: the HUD also needs
 * a development build, decided where each piece is imported (a literal `import.meta.env.MODE` there, which the
 * production build folds away; a helper would not be). Never throws.
 */
export function debugTwinRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get('debug') === 'twin';
  } catch {
    return false;
  }
}

/** Whether this tab remembered the flag; storage that is missing, blocked or holds anything else reads as not. */
export function readDebugTwin(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === REMEMBERED;
  } catch {
    return false;
  }
}

/** Remembers the flag for this tab, so it survives the sign-in redirect. */
export function rememberDebugTwin(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, REMEMBERED);
  } catch {
    // Not remembered: the address still opens the HUD for this page.
  }
}

/** Forgets the flag, for a tab loaded without it. */
export function forgetDebugTwin(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not forgotten: `debugTwinCarried()` only reads it back on a sign-in callback, which this tab no longer makes.
  }
}

/** Whether the address is the sign-in redirect's callback; the same test as `auth/session.ts` and `lib/wall/wallMode.ts`. */
function isSigninCallback(search: string): boolean {
  const params = new URLSearchParams(search);
  return (params.has('code') || params.has('error')) && params.has('state');
}

/**
 * Whether this page carries the flag: the address's while it has it, else, on the sign-in callback only, what the tab
 * remembered. Any other address without it does not, whatever an earlier page of the tab did. Mirrors `wallScreen()`.
 */
export function debugTwinCarried(): boolean {
  try {
    if (debugTwinRequested(location.search)) return true;
    return isSigninCallback(location.search) && readDebugTwin();
  } catch {
    // No `location`: not a browser page.
    return false;
  }
}
