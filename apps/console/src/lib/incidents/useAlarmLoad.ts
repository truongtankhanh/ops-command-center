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
  rate: number;
  flood: FloodState;
  standing: number;
  noisy: NoisyDevice[];
  buckets: number[];
  /** The cached list is as long as the request: every measure is then a lower bound (see `isPartial`). */
  partial: boolean;
}

// The rate is per 10 minutes, so a 15 s step is within its noise; the same step as the other readers of the clock.
const ALARM_LOAD_TICK_MS = 15_000;

// One value for every render before the list arrives, so the model keeps its identity and a consumer's memo holds.
const NOT_LOADED: AlarmLoad = {
  loaded: false,
  rate: 0,
  flood: { flooding: false, since: null, rate: 0 },
  standing: 0,
  noisy: [],
  buckets: Array.from({ length: RAISED_BUCKETS }, () => 0),
  partial: false,
};

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
 * Only the incident list gates `loaded`: the catalogue is needed for `noisy` alone, so while it is missing `noisy` is empty. A
 * reader of `noisy` must not say "no noisy devices" until the catalogue is known.
 */
export function useAlarmLoad(): AlarmLoad {
  const { data: incidents } = useIncidents();
  const { data: assets } = useAssets();
  const now = useNow(ALARM_LOAD_TICK_MS);
  const catalogue = assets ?? EMPTY_ASSETS;

  return useMemo(() => {
    if (incidents === undefined) return NOT_LOADED;
    const flood = floodState(incidents, now);
    return {
      loaded: true,
      rate: alarmRate(incidents, now),
      flood,
      standing: standingCount(incidents, now),
      noisy: noisyDevices(incidents, catalogue, now),
      buckets: raisedPerBucket(incidents, now),
      partial: isPartial(incidents),
    };
  }, [incidents, catalogue, now]);
}
