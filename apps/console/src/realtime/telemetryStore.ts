import type { TelemetryValue } from '@occ/contracts';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { ageMs, isStale, serverNow } from '../lib/telemetryFreshness';
import {
  type AssetTelemetryState,
  initialTelemetryState,
  type TelemetryPillState,
  telemetryPillState,
} from '../lib/telemetryState';
import {
  seriesKey,
  type SeriesView,
  type TelemetryClient,
  type TelemetryView,
} from './telemetryClient';

/**
 * What React reads of telemetry (ADR-0019, ADR-0020 § State). The client of V2-08.4 owns the
 * socket and the buffers and posts reduced state at most four times a second; this is its mirror.
 *
 * A store of its own, not part of `useConsole`, as `ui/toasts.ts` is: readings change every
 * second, and nothing per reading may churn the console's UI state. Selectors return a stored
 * reference (an asset's entry, a series) or a primitive, never an object built in the selector:
 * Zustand 5 re-renders on any new reference. A component that reads CT-01 therefore does not
 * re-render when only CT-02 changed, because the reducer and the client keep every untouched
 * asset's object.
 */

const initialView: TelemetryView = { state: initialTelemetryState, series: new Map() };

interface TelemetryStoreState {
  view: TelemetryView;
  /** The live client, for actions that are not a render (V2-08.6's "Reconnect"). */
  client: TelemetryClient | null;
  /**
   * Mirrors `client` here, now and on every change, until the returned function is called, which
   * stops and resets the store. It does not dispose the client: that is the caller's, which made it.
   */
  adopt(client: TelemetryClient): () => void;
}

export const useTelemetryStore = create<TelemetryStoreState>((set, get) => ({
  view: initialView,
  client: null,
  adopt: (client) => {
    set({ client, view: client.getView() });
    const stop = client.subscribe(() => set({ view: client.getView() }));
    return () => {
      stop();
      // A newer client may already have been adopted (StrictMode's second mount): leave it.
      if (get().client === client) set({ client: null, view: initialView });
    };
  },
}));

/** One asset's latest state, as the store holds it; `undefined` when nothing was received. */
export const useAssetState = (assetCode: string): AssetTelemetryState | undefined =>
  useTelemetryStore((s) => s.view.state.assets[assetCode]);

/** One key's recent points of a watched asset; `undefined` when it has none (or is not watched). */
export const useAssetSeries = (assetCode: string, key: string): SeriesView | undefined =>
  useTelemetryStore((s) => s.view.series.get(seriesKey(assetCode, key)));

/**
 * The API's time now, to the second: the last anchor plus the time since it arrived, read once a
 * second. `null` until the first overview. It re-renders its caller every second, so a list should
 * call it once and pass the number down. Right after a re-anchor it can lag by up to a second, which
 * is the clock's own resolution; the monotonic reading is taken in the timer, never in render.
 *
 * `active` (default `true`) is for a caller that needs the clock only some of the time: with `false` no timer runs
 * and the clock is not followed (each overview re-anchors it, so following it is a render a second too), and the
 * answer is `null`; the caller is not re-rendered every second for nothing (the 3D stage while Heat is off, V2-17.3).
 * After `active` turns `true` the value is right from the first tick, up to a second later, as after a re-anchor.
 */
export function useServerNow(active = true): number | null {
  const clock = useTelemetryStore((s) => (active ? s.view.state.serverClock : null));
  const [mono, setMono] = useState(() => performance.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setMono(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return serverNow(clock, mono);
}

export interface AssetFreshness {
  /** ISO time the API received the asset's latest reading. */
  receivedAt: string;
  ageMs: number;
  /** At or past the asset's threshold; `false` when no threshold is known. */
  stale: boolean;
}

export interface AssetOverview {
  /** `false` once the device's last will fired. */
  online: boolean;
  headline: Readonly<Record<string, TelemetryValue>>;
  /** `null` until the server's clock is known. */
  freshness: AssetFreshness | null;
}

export interface AssetTelemetryView extends AssetOverview {
  values: Readonly<Record<string, TelemetryValue>>;
  /**
   * Per key, how long ago it last got a new value. Not "how long since the device reported": a frame
   * carries changed keys only, so a steady key ages while the device is healthy (V2-08.3). For
   * display; whether an asset is stale is `freshness.stale`. Empty until the clock is known.
   */
  keyAgesMs: Readonly<Record<string, number>>;
  /** This asset's series, by point key. */
  series: ReadonlyMap<string, SeriesView>;
}

function freshnessOf(
  asset: AssetTelemetryState,
  staleAfterMs: number | null,
  now: number | null,
): AssetFreshness | null {
  if (now === null) return null;
  return {
    receivedAt: asset.receivedAt,
    ageMs: ageMs(asset.receivedAt, now),
    stale: isStale(asset.receivedAt, staleAfterMs, now),
  };
}

/**
 * An asset's online state, headline values and how old they are. `staleAfterMs` comes from the
 * catalogue (`staleAfterMs(asset.headline)`), which this store does not hold; `null` says "cannot
 * judge" and never reads as stale. Facts only: combining them with an open incident into one state
 * is the asset list's job (V2-09.3). Changes every second, with the clock.
 */
export function useAssetOverview(
  assetCode: string,
  staleAfterMs: number | null = null,
): AssetOverview | undefined {
  const asset = useAssetState(assetCode);
  const now = useServerNow();
  return useMemo(
    () =>
      asset === undefined
        ? undefined
        : {
            online: asset.online,
            headline: asset.headline,
            freshness: freshnessOf(asset, staleAfterMs, now),
          },
    [asset, staleAfterMs, now],
  );
}

/**
 * Everything held about one asset: the overview, every latest value, per-key ages and the series of
 * its keys. Changes every second; a component that only needs the values reads `useAssetState`.
 */
export function useAssetTelemetry(
  assetCode: string,
  staleAfterMs: number | null = null,
): AssetTelemetryView | undefined {
  const asset = useAssetState(assetCode);
  const allSeries = useTelemetryStore((s) => s.view.series);
  const now = useServerNow();
  return useMemo(() => {
    if (asset === undefined) return undefined;
    const keyAgesMs: Record<string, number> = {};
    if (now !== null) {
      for (const [key, receivedAt] of Object.entries(asset.keyReceivedAt)) {
        keyAgesMs[key] = ageMs(receivedAt, now);
      }
    }
    const prefix = seriesKey(assetCode, '');
    const series = new Map<string, SeriesView>();
    for (const [id, view] of allSeries) {
      if (id.startsWith(prefix)) series.set(id.slice(prefix.length), view);
    }
    return {
      online: asset.online,
      headline: asset.headline,
      freshness: freshnessOf(asset, staleAfterMs, now),
      values: asset.values,
      keyAgesMs,
      series,
    };
  }, [asset, allSeries, assetCode, staleAfterMs, now]);
}

export interface TelemetryStatusView {
  /** The pill's state; five of them (V2-08.1). */
  pill: TelemetryPillState;
  /** Since when the API's source has been paused (ISO, the API's clock); read it for `paused`. */
  upstreamSince: string | null;
  /** Since when this console's own socket has not been live (epoch ms, this console's clock); read it for `reconnecting`. */
  socketSince: number | null;
}

export function useTelemetryStatus(): TelemetryStatusView {
  const pill = useTelemetryStore((s) => telemetryPillState(s.view.state));
  const upstreamSince = useTelemetryStore((s) => s.view.state.upstreamSince);
  const socketSince = useTelemetryStore((s) => s.view.state.socketSince);
  return useMemo(() => ({ pill, upstreamSince, socketSince }), [pill, upstreamSince, socketSince]);
}
