import type { Incident, IncidentSeverity } from '@occ/contracts';

/*
 * Attention countdown (V3-22.1, frame 17, brief § Operations aids): the time an open incident has left before V1's
 * attention threshold, as a pure function of the incident and `now`. Like `alarmLoad.ts` it reads no clock, no store and
 * no React, so a test needs no timers and every console gives the same answer.
 *
 * Display only, and called an attention threshold, never an SLA: nothing enforces it server-side (V1 Approved decision 3).
 * OCC-26 later replaces the constants with the server's deadline, which plugs in through `deadlineOf`.
 */

const MINUTE_MS = 60_000;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 24 * HOUR_SECONDS;

/**
 * How long an incident may stay open (not acknowledged) before the feed flags its age. Provisional
 * values from the design brief (Approved decision 3), still to be confirmed with operations.
 * Display only, not an SLA: nothing enforces it server-side, and OCC-26 replaces it with the
 * server's SLA.
 */
export const ATTENTION_THRESHOLD_MS: Readonly<Record<IncidentSeverity, number>> = {
  critical: 2 * MINUTE_MS,
  high: 5 * MINUTE_MS,
  medium: 15 * MINUTE_MS,
  low: 30 * MINUTE_MS,
};

/**
 * The share of its time an open incident has left, or less, when the countdown turns "soon". `unverified`: a first
 * figure from the brief, to be read with operations like the thresholds above.
 */
export const ATTENTION_SOON_FRACTION = 0.25;

export type CountdownState = 'normal' | 'soon' | 'overdue';

export interface AttentionCountdown {
  readonly state: CountdownState;
  /** Time left to the deadline in ms; zero or negative once `overdue` (not clamped, so the time over can be said). */
  readonly remainingMs: number;
  /** `remainingMs` over the whole time allowed, from 0 to 1. */
  readonly fraction: number;
}

/** The moment, in epoch ms, by which an open incident should have been acknowledged. */
export type DeadlineOf = (incident: Incident) => number;

/**
 * Reported time plus the severity's threshold. A severity this console does not know (the API may add one first) has no
 * threshold and gives `NaN`, which `attentionCountdown` reads as "no countdown".
 */
const attentionDeadline: DeadlineOf = (incident) => {
  const threshold: number | undefined = ATTENTION_THRESHOLD_MS[incident.severity];
  return threshold === undefined ? NaN : Date.parse(incident.reportedAt) + threshold;
};

/**
 * The countdown of an open incident, or `null` when it has none: it is acknowledged or resolved (acknowledging clears it,
 * V1), its severity is not known, or a time cannot be read.
 *
 * `overdue` from the deadline on (`remainingMs <= 0`), `soon` at `ATTENTION_SOON_FRACTION` of the time left or less. A
 * `reportedAt` after `now` (clock skew) counts as `now`, so the countdown is at its full length and never longer.
 */
export function attentionCountdown(
  incident: Incident,
  now: number,
  deadlineOf: DeadlineOf = attentionDeadline,
): AttentionCountdown | null {
  if (incident.status !== 'open') return null;
  const reportedAt = Date.parse(incident.reportedAt);
  if (Number.isNaN(reportedAt)) return null;
  const deadline = deadlineOf(incident);
  if (!Number.isFinite(deadline)) return null;

  const total = deadline - reportedAt;
  const remainingMs = deadline - Math.max(now, reportedAt);
  // A deadline at or before the report leaves no time to share out: overdue, nothing left, and no division by zero.
  const fraction = total > 0 ? Math.min(1, Math.max(0, remainingMs / total)) : 0;
  // Compared as time, not as `fraction`, so no division decides the boundary: exactly a quarter left is "soon".
  const state: CountdownState =
    remainingMs <= 0
      ? 'overdue'
      : remainingMs <= total * ATTENTION_SOON_FRACTION
        ? 'soon'
        : 'normal';
  return { state, remainingMs, fraction };
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * `m:ss`, `1h 05m` from an hour on, and `22d 15h` from a day on: an incident left open for weeks would otherwise read
 * `+543h 50m over`, which nobody reads as three weeks and which no longer fits the feed row's line.
 */
function clock(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / DAY_SECONDS);
  if (days > 0) return `${days}d ${pad(Math.floor((totalSeconds % DAY_SECONDS) / HOUR_SECONDS))}h`;
  const hours = Math.floor(totalSeconds / HOUR_SECONDS);
  if (hours > 0) return `${hours}h ${pad(Math.floor((totalSeconds % HOUR_SECONDS) / 60))}m`;
  return `${Math.floor(totalSeconds / 60)}:${pad(totalSeconds % 60)}`;
}

/**
 * The countdown as the ring's text, from the signed time left: `1:52`, `30:00`, then `+2:10 over` and `+1h 05m over` once
 * past the deadline, and `+22d 03h over` from a day on. A time left rounds up to the second, so `0:00` is never shown
 * before the deadline; a time over rounds down, so `+0:00 over` is the first second after it.
 */
export function formatCountdown(remainingMs: number): string {
  if (remainingMs > 0) return clock(Math.ceil(remainingMs / 1000));
  return `+${clock(Math.floor(-remainingMs / 1000))} over`;
}

const minutes = (count: number) => `${count} ${count === 1 ? 'minute' : 'minutes'}`;

/**
 * The countdown as a sentence for assistive technology and the row's name, in whole minutes and no seconds, so it changes
 * once a minute and a focused row is not read out again every second.
 */
export function countdownSpeech({ remainingMs }: AttentionCountdown): string {
  if (remainingMs > 0) {
    if (remainingMs < MINUTE_MS) return 'attention time in less than a minute';
    return `attention time in ${minutes(Math.ceil(remainingMs / MINUTE_MS))}`;
  }
  const over = -remainingMs;
  if (over < MINUTE_MS) return 'just past attention time';
  return `past attention time by ${minutes(Math.floor(over / MINUTE_MS))}`;
}
