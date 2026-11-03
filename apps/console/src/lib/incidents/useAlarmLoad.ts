import type { Asset } from '@occ/contracts';
import { useMemo } from 'react';
import { useAssets, useIncidents } from '../../api/queries';
import { useNow } from '../shared/useNow';
import {
  alarmRate,
  type FloodState,
  floodState,
  isPartial,
  type NoisyDevice,
  noisyDevices,
  RAISED_BUCKETS,
  raisedPerBucket,
  standingCount,
} from './alarmLoad';

/**
 * The alarm load (V3-21.1) as the screens read it. `loaded` is false until the incident list has arrived; every other
 * field is then a zero or an empty value, and the consumer decides what to draw (the status bar draws a dash), so a number
 * that is not known yet is never shown as 0.
 */
export interface AlarmLoad {
  loaded: boolean;
  /** The list could not be fetched and nothing is cached: the reader says so (the panel, V3-21.3) instead of waiting. */
  failed: boolean;
  /** The clock the model was computed at, so a time drawn beside a number (the chart's peak) is the number's own. 0 until `loaded`. */
  now: number;
  rate: number;
  flood: FloodState;
  standing: number;
  noisy: NoisyDevice[];
  /** The catalogue has arrived: an empty `noisy` is then "none", before that it is "not known yet". */
  noisyKnown: boolean;
  buckets: number[];
  /** The cached list is as long as the request: every measure is then a lower bound (see `isPartial`). */
  partial: boolean;
}

// The rate is per 10 minutes, so a 15 s step is within its noise; the same step as the other readers of the clock.
const ALARM_LOAD_TICK_MS = 15_000;

// One value for every render before the list arrives, so the model keeps its identity and a consumer's memo holds.
const NOT_LOADED: AlarmLoad = {
  loaded: false,
  failed: false,
  now: 0,
  rate: 0,
  flood: { flooding: false, since: null, rate: 0 },
  standing: 0,
  noisy: [],
  noisyKnown: false,
  buckets: Array.from({ length: RAISED_BUCKETS }, () => 0),
  partial: false,
};

// The same for a list that failed, a second constant so neither is a new object per render.
const FAILED: AlarmLoad = { ...NOT_LOADED, failed: true };

// A catalogue that has not arrived is a stable empty list, not a new `[]` per render, or the memo below would never hold.
const EMPTY_ASSETS: readonly Asset[] = [];

/**
 * Reads the alarm-load model once (V3-21.2, frame 16), so the status bar, the popover (V3-21.3) and the banner (V3-21.4) show one
 * answer and the model is computed once per tick and per change of the list, not once per reader. It adds no request: the
 * incident list is kept fresh by live events and the catalogue is reference data, both read elsewhere in the console.
 *
 * The model is a function of the list and the clock, so the clock is the only state here: `useNow` re-renders the reader every
 * 15 s, which is also what lets an incident leave the 10-minute window. A live incident is counted at once even though `now`
 * is up to 15 s old, because the model counts a report after `now` as `now` (the clock-skew rule).
 *
 * Only the incident list gates `loaded`: the catalogue is needed for `noisy` alone, so while it is missing `noisy` is empty and
 * `noisyKnown` is false. A reader of `noisy` must not say "no noisy devices" until `noisyKnown`. `failed` is set only when the
 * list errored and nothing is cached: a refetch that fails over a cached list keeps showing the list.
 */
export function useAlarmLoad(): AlarmLoad {
  const { data: incidents, isError } = useIncidents();
  const { data: assets } = useAssets();
  const now = useNow(ALARM_LOAD_TICK_MS);
  const catalogue = assets ?? EMPTY_ASSETS;
  const noisyKnown = assets !== undefined;

  return useMemo(() => {
    if (incidents === undefined) return isError ? FAILED : NOT_LOADED;
    const flood = floodState(incidents, now);
    return {
      loaded: true,
      failed: false,
      now,
      rate: alarmRate(incidents, now),
      flood,
      standing: standingCount(incidents, now),
      noisy: noisyDevices(incidents, catalogue, now),
      noisyKnown,
      buckets: raisedPerBucket(incidents, now),
      partial: isPartial(incidents),
    };
  }, [incidents, isError, catalogue, noisyKnown, now]);
}
