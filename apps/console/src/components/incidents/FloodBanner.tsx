import { useEffect } from 'react';
import {
  ALARM_RATE_WINDOW_MS,
  FLOOD_END_BELOW,
  FLOOD_START_ABOVE,
} from '../../lib/incidents/alarmLoad';
import { type AlarmLoad, useAlarmLoad } from '../../lib/incidents/useAlarmLoad';
import { useConsole } from '../../store';
import { Banner } from '../../ui/Banner';
import { alarmLoadIcon } from '../../ui/icons';
import styles from './FloodBanner.module.css';

const WINDOW_MINUTES = ALARM_RATE_WINDOW_MS / 60_000;

/*
 * The alarm flood banner (V3-21.4, frame 16): one banner over the stage while the rate is above the flood threshold, with the
 * switch that groups the feed by zone. `App` places it in the system banners' stack, after the connection and telemetry banners
 * and before the dismissible 3D one.
 *
 * - **Mounted for as long as the flood lasts** (as `OfflineBanner`), so its `role="status"` is announced once, when it is inserted,
 *   and it has no dismiss: it ends with the flood. A flood is workload, not a fault, so nothing else in the console changes.
 * - **The figure does not re-announce.** `Banner` puts everything inside the live element, and the rate moves while the flood
 *   lasts, so the number sits in a nested `aria-live="off"` span and the detail is fixed words. (A nested `off` is honoured by
 *   NVDA and JAWS; VoiceOver is the weakest. The structure is what the tests hold.)
 * - **A lower bound is never drawn as exact.** While the cached list is full (`partial`) every measure is a minimum (V3-21.1),
 *   so the figure reads "at least 14".
 * - **The skew between readers.** This, the status bar and the feed each call `useAlarmLoad()`, so each has its own 15 s clock. An
 *   incident that arrives is counted at once by all of them; one that leaves the 10-minute window can leave one reader up to
 *   15 s before another. Accepted: a provider would be a second mechanism for a negligible gain.
 * - **No camera, no "Alarm load" button.** The status bar's button is the way to the panel (V3-21.3), whose open state is the
 *   Popover's own. The wall never mounts this banner.
 */
export function FloodBanner() {
  const load = useAlarmLoad();
  if (!load.flood.flooding) return null;
  return <FloodBannerBody load={load} />;
}

/**
 * Exists exactly while the flood does, so its cleanup is the flood's end: it clears the operator's choice to group, and the next
 * flood does not start grouped. The feed groups only when the flag and the flood are both on, so the list is restored whatever
 * the flag says; this only keeps the choice from outliving the flood it was made in.
 */
function FloodBannerBody({ load }: { load: AlarmLoad }) {
  const grouped = useConsole((s) => s.groupByZone);
  const setGroupByZone = useConsole((s) => s.setGroupByZone);

  useEffect(() => () => setGroupByZone(false), [setGroupByZone]);

  return (
    <Banner
      role="status"
      icon={alarmLoadIcon(true)}
      detail={`More than ${FLOOD_START_ABOVE} in ${WINDOW_MINUTES} minutes. It ends below ${FLOOD_END_BELOW}.`}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={grouped}
          className={styles.switchButton}
          onClick={() => setGroupByZone(!grouped)}
        >
          Group by zone
          <span className={styles.switch} aria-hidden="true" />
        </button>
      }
    >
      Alarm flood:{' '}
      <span aria-live="off">{`${load.partial ? 'at least ' : ''}${load.flood.rate}`}</span>
      {` raised in ${WINDOW_MINUTES} min`}
    </Banner>
  );
}
