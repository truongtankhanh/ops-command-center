import type { TelemetryStatus, TelemetryValue } from '@occ/contracts';

/** One reading as a source hands it over, before anything has checked it against the catalogue. */
export interface RawReading {
  assetCode: string;
  /** ISO time the device measured the values; absent when the source cannot say. */
  at?: string;
  values: Record<string, TelemetryValue>;
}

/** The wire shape of `telemetry.status`, so the gateway can forward it as it is. */
export type UpstreamState = TelemetryStatus;

/** Removes the listener it was returned for; calling it again does nothing. */
export type Unsubscribe = () => void;

/**
 * Port: where telemetry readings come from (ADR-0019). Implementations decide *how* a reading
 * arrives, generated in process or received from a broker; callers never do. The implementation is
 * chosen once, at startup, from `TELEMETRY_SOURCE`.
 *
 * Contract:
 * - Register listeners before `start()`: the upstream state is reported once at `start()`, then on
 *   every change, and is not replayed to a listener that registers later.
 * - A source emits only between `start()` and `stop()`. `stop()` is idempotent and leaves no timer
 *   or connection behind; `start()` may follow it.
 * - A listener that throws neither stops the source nor starves the other listeners.
 * - A reading is not validated here. An unknown asset or key, a value of the wrong kind or out of
 *   range is the consumer's to drop and count (ADR-0019, "Validation in the bridge").
 */
export interface TelemetrySource {
  readonly kind: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onReading(listener: (reading: RawReading) => void): Unsubscribe;
  onUpstream(listener: (state: UpstreamState) => void): Unsubscribe;
}
