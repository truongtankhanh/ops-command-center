import type { TelemetryValue } from '@occ/contracts';
import { valueAt, type WaveformPoint, type WaveformRule } from './waveform';

/** One asset of `catalogue.json`: what the simulator needs to play its device. */
export interface SimAsset {
  code: string;
  classCode: string;
  points: WaveformPoint[];
  rules: WaveformRule[];
}

/** One MQTT `telemetry` payload to publish, before it is serialised. */
export interface SimReading {
  assetCode: string;
  /** ISO time of the interval boundary the values belong to, never the wall clock. */
  at: string;
  values: Record<string, TelemetryValue>;
}

/**
 * The readings of `asset` that came due since `lastBoundary` last saw it, as the mock source
 * computes them (`mock-telemetry-source.ts`): per point, the latest boundary of its interval at
 * `nowMs`, one value per boundary (latest wins when a tick finds several behind), and the points
 * that share a boundary go in one reading. `lastBoundary` is the caller's state, keyed
 * `<asset>/<key>`, and is updated here.
 *
 * Same functions and same boundaries as the mock, so the demo with `TELEMETRY_SOURCE=mqtt` shows
 * the numbers the demo with `mock` shows.
 */
export function dueReadings(
  asset: SimAsset,
  nowMs: number,
  lastBoundary: Map<string, number>,
): SimReading[] {
  const byBoundary = new Map<number, Record<string, TelemetryValue>>();

  for (const point of asset.points) {
    const intervalMs = point.expectedIntervalS * 1000;
    const boundary = Math.floor(nowMs / intervalMs) * intervalMs;
    const id = `${asset.code}/${point.key}`;
    const last = lastBoundary.get(id);
    if (last !== undefined && boundary <= last) continue;

    lastBoundary.set(id, boundary);
    const value = valueAt(asset.code, point, asset.rules, boundary);
    if (value === undefined) continue;
    const values = byBoundary.get(boundary) ?? {};
    values[point.key] = value;
    byBoundary.set(boundary, values);
  }

  return [...byBoundary].map(([boundary, values]) => ({
    assetCode: asset.code,
    at: new Date(boundary).toISOString(),
    values,
  }));
}
