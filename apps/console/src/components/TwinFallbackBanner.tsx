import { useState } from 'react';
import { readTwinBannerDismissed, writeTwinBannerDismissed } from '../lib/twinBannerDismissal';
import { TWIN_UNAVAILABLE_COPY, type TwinUnavailableReason } from '../lib/twinCapability';
import { useTwinCapability } from '../lib/useTwinCapability';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Info, X } from '../ui/icons';
import styles from './TwinFallbackBanner.module.css';
import { VIEW_SWITCH_3D_ID } from './ViewSwitch';

/**
 * Frames 07 / 14: says why the stage shows the 2D map and 3D is off, in the words of the reason
 * (`TWIN_UNAVAILABLE_COPY`). Mounted only while the twin cannot be drawn and the operator has not
 * dismissed it for that reason in this tab, so it is announced once when it appears (`status`, as
 * `OfflineBanner`), also when the reason arrives mid-session (`context-lost`). Dismissing is
 * remembered per tab and per reason. The switch's 3D option carries
 * the same reason as its description, so nothing is lost once this is gone.
 *
 * `App` stacks it last in the stage's banners: it is the one that matters least.
 */
export function TwinFallbackBanner() {
  const capability = useTwinCapability();
  const reason = capability.available ? null : capability.reason;
  const [dismissedFor, setDismissedFor] = useState<TwinUnavailableReason | null>(null);
  // Read for the reason in effect now, not once at mount: a reason that arrives later (a lost
  // context) must honour a dismissal made earlier in this tab. The local state keeps it closed
  // where storage is unavailable.
  if (reason === null || dismissedFor === reason || readTwinBannerDismissed(reason)) return null;

  const copy = TWIN_UNAVAILABLE_COPY[reason];
  const dismiss = () => {
    writeTwinBannerDismissed(reason);
    // Focus leaves a button that is about to unmount, for the control the banner explained.
    document.getElementById(VIEW_SWITCH_3D_ID)?.focus();
    setDismissedFor(reason);
  };

  return (
    <Banner
      role="status"
      icon={Info}
      detail={copy.detail}
      action={
        <Button
          variant="ghost"
          size="sm"
          icon={X}
          aria-label="Dismiss"
          className={styles.dismiss}
          onClick={dismiss}
        />
      }
    >
      {copy.title}
    </Banner>
  );
}
