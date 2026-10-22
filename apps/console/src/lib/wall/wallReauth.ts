/*
 * How often an unattended video wall may send itself back to the identity provider (V2-21.10, ADR-0020 "Settled in
 * V2-21.1", bullet "Staying signed in"). On the console a failed renewal waits for a person to press "Sign in again"; on a
 * wall nobody is there, so the wall presses it itself, and this is what stops that from becoming a loop that hammers
 * Keycloak: a redirect that comes straight back to a session that fails again would otherwise repeat at the speed of a
 * page load.
 *
 * Pure apart from the storage helpers at the end, and the clock is the caller's: the record has to survive the redirect
 * (the page is gone and a new one starts), so it is kept in `sessionStorage`, the tab's, with the wall's number
 * (`lib/wall/wallMode.ts`), and its time is the wall clock (`Date.now()`); a monotonic clock does not outlive a page.
 */

/** The shortest gap between two automatic attempts: never more than one a minute. */
export const REAUTH_BASE_MS = 60_000;
/** The longest gap the back-off grows to: a wall left with no sign-in page to reach still tries four times an hour. */
export const REAUTH_MAX_MS = 15 * 60_000;
/**
 * A record this old is forgotten: failures this far apart are not one run. It is above `REAUTH_MAX_MS`, so a run still
 * going is never mistaken for a new one, and far below a session's life, so a wall that signed in again and held for hours
 * starts its next failure from the shortest gap.
 */
export const REAUTH_STALE_MS = 30 * 60_000;

/** How many automatic attempts the run has made, and when the last one began. */
export interface ReauthRecord {
  attempts: number;
  at: number;
}

export const NO_REAUTH: ReauthRecord = { attempts: 0, at: 0 };

/** Whether `record` belongs to a run that is over. A clock that went backwards ends it too. */
const isStale = (record: ReauthRecord, now: number): boolean =>
  record.attempts <= 0 || now < record.at || now - record.at > REAUTH_STALE_MS;

/**
 * How long to wait before the next attempt, in ms: none for the first of a run, then a minute, two, four, and so on up to
 * `REAUTH_MAX_MS`, counted from when the last one began.
 */
export function reauthDelay(record: ReauthRecord, now: number): number {
  if (isStale(record, now)) return 0;
  const gap = Math.min(REAUTH_BASE_MS * 2 ** (record.attempts - 1), REAUTH_MAX_MS);
  return Math.max(0, gap - (now - record.at));
}

/** The record after an attempt that begins at `now`. */
export function recordAttempt(record: ReauthRecord, now: number): ReauthRecord {
  return { attempts: (isStale(record, now) ? 0 : record.attempts) + 1, at: now };
}

const STORAGE_KEY = 'occ.console.wall.reauth';
/** Where storage is blocked the run is remembered for this page only: a loop through redirects is then not slowed. */
let memory: ReauthRecord = NO_REAUTH;

export function readReauth(): ReauthRecord {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage is blocked: the run is what this page remembers.
    return memory;
  }
  // Storage works and holds nothing (or something that is not a record): there is no run, whatever memory says.
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    if (typeof parsed === 'object' && parsed !== null) {
      const { attempts, at } = parsed as Partial<ReauthRecord>;
      if (Number.isSafeInteger(attempts) && Number.isFinite(at)) {
        return { attempts: attempts as number, at: at as number };
      }
    }
  } catch {
    // Not JSON.
  }
  return NO_REAUTH;
}

export function writeReauth(record: ReauthRecord): void {
  memory = record;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage is optional.
  }
}

/** Forgets the run: the wall is signed in and has held. */
export function clearReauth(): void {
  memory = NO_REAUTH;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is optional.
  }
}
