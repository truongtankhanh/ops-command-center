import { formatClock } from './incidents/incidents';

/**
 * How a reading's age and "since" time are written: the display half of freshness. The wording is
 * frame 05's ("1 min 12 s old", "No data · 1 min"), which the compact `formatAge` of the incident
 * feed ("1m") does not match. Kept apart from `telemetryFreshness.ts` so the worker never imports it.
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * An age with the precision the inspector's per-reading label needs: `0.4 s`, `12 s`, `1 min`,
 * `1 min 12 s`, `1 h 5 min`, `2 d 3 h`. Two units at most; hours give way to days after 48 h, as
 * `formatDuration` does.
 */
export function formatReadingAge(ms: number): string {
  const total = Math.max(0, ms);
  if (total < SECOND_MS) return `${(Math.floor(total / 100) / 10).toFixed(1)} s`;
  if (total < MINUTE_MS) return `${Math.floor(total / SECOND_MS)} s`;
  if (total < HOUR_MS) {
    const minutes = Math.floor(total / MINUTE_MS);
    const seconds = Math.floor((total % MINUTE_MS) / SECOND_MS);
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }
  if (total < 2 * DAY_MS) {
    const hours = Math.floor(total / HOUR_MS);
    const minutes = Math.floor((total % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }
  const days = Math.floor(total / DAY_MS);
  const hours = Math.floor((total % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}

/**
 * The same age for a list row, where the second unit is noise: `12 s`, `1 min`, `1 h`, `3 d`.
 * Under a minute it reads as `formatReadingAge` does.
 */
export function formatAgeCoarse(ms: number): string {
  const total = Math.max(0, ms);
  if (total < MINUTE_MS) return formatReadingAge(total);
  if (total < HOUR_MS) return `${Math.floor(total / MINUTE_MS)} min`;
  if (total < 2 * DAY_MS) return `${Math.floor(total / HOUR_MS)} h`;
  return `${Math.floor(total / DAY_MS)} d`;
}

/**
 * The clock time of "No data since …" and "Offline since …": `HH:MM`, with the date when it is not
 * the same day as `serverNow` (V2-08.1). Judged on the server's day, like the age it sits beside.
 */
export const formatSince = (iso: string, serverNow: number): string => formatClock(iso, serverNow);
