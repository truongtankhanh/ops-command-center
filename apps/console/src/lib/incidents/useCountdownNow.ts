import type { Incident } from '@occ/contracts';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { attentionCountdown } from './attentionCountdown';

/**
 * The time left at or under which the feed's clock ticks every second (V3-22.2, frame 17): the countdown's seconds only matter
 * when the deadline is near, and an incident already past it (negative time left) counts, because its `+m:ss over` keeps
 * running. `unverified`, display only: read it with operations like the attention thresholds.
 */
export const COUNTDOWN_TICK_UNDER_MS = 10 * 60_000;

const FAST_TICK_MS = 1000;
// `useNow`'s own period: far from any deadline a figure that is 15 s old is still true to the minute.
const SLOW_TICK_MS = 15_000;

// The same shape as `usePrefersReducedMotion`: browser state read through an external store, with no tab in a server render.
function subscribeToVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
const isHidden = () => document.hidden;
const neverHidden = () => false;

/**
 * The clock of a list that counts down (V3-22.2), for the feed (V3-22.3) and the table (V3-24.4). It returns `now`, ticking every
 * second while at least one of the given incidents is open with `COUNTDOWN_TICK_UNDER_MS` left or less, and every 15 s
 * otherwise, which is what `useNow` does and keeps the cost of a quiet console where it was.
 *
 * One timer serves the whole list, never one per row, and it stops with the component. A hidden tab has no timer at all: nobody
 * reads the figures, so a background tab is not woken for them, and `now` is set again the moment the tab is back so it never
 * shows a figure from before it was hidden. The period is decided from the last `now`, so an incident that enters its last ten
 * minutes is noticed at the next slow tick, up to 15 s late, when the text is still a round `10:00` or so.
 */
export function useCountdownNow(incidents: readonly Incident[]): number {
  const [now, setNow] = useState(() => Date.now());
  const hidden = useSyncExternalStore(subscribeToVisibility, isHidden, neverHidden);

  const fast = useMemo(
    () =>
      incidents.some((incident) => {
        const countdown = attentionCountdown(incident, now);
        return countdown !== null && countdown.remainingMs <= COUNTDOWN_TICK_UNDER_MS;
      }),
    [incidents, now],
  );

  // On the way back from a hidden tab, read the clock at once instead of waiting a period for the new timer's first tick.
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setNow(Date.now());
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);

  useEffect(() => {
    if (hidden) return;
    const timer = setInterval(() => setNow(Date.now()), fast ? FAST_TICK_MS : SLOW_TICK_MS);
    return () => clearInterval(timer);
  }, [hidden, fast]);

  return now;
}
