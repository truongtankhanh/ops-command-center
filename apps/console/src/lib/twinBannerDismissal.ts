import type { TwinUnavailableReason } from './twinCapability';

/** Per tab, like the OIDC state: a new tab or a new visit tells the operator again. */
const STORAGE_KEY = 'occ.console.twinBannerDismissed';

/**
 * Whether the operator dismissed the banner for this reason in this tab. The reason is what is
 * stored, so a different reason (V2-12's `no-webgl2` after a `not-built` dismissal) shows again.
 * Unavailable storage reads as "not dismissed": the banner shows, which is the safe side.
 */
export function readTwinBannerDismissed(reason: TwinUnavailableReason): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === reason;
  } catch {
    return false;
  }
}

export function writeTwinBannerDismissed(reason: TwinUnavailableReason): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, reason);
  } catch {
    // Not remembered: the banner still stays closed until the page reloads.
  }
}
