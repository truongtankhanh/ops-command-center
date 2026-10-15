import { useEffect } from 'react';
import { createTelemetryClient } from './telemetryClient';
import { useTelemetryStore } from './telemetryStore';

/**
 * How long a wanted set must hold still before it is sent. Selecting one asset after another in
 * quick succession then sends the last one. The engine's 250 ms throttle and the server's 5 a
 * second are the backstops (ADR-0019).
 */
const WATCH_DEBOUNCE_MS = 200;

/**
 * Starts the telemetry path for the console's lifetime: one client (the worker, its socket and
 * buffers) mirrored into `useTelemetryStore`. Mount it once, beside `useLiveIncidents()`.
 *
 * The client is made in the effect and disposed in its cleanup, so React StrictMode's mount,
 * cleanup, mount leaves one live client and a store that starts again from nothing, as
 * `useLiveIncidents` does with its socket.
 */
export function useTelemetry(): void {
  useEffect(() => {
    const client = createTelemetryClient();
    const release = useTelemetryStore.getState().adopt(client);
    return () => {
      release();
      client.dispose();
    };
  }, []);
}

/**
 * Asks the API for every reading of `codes` (asset codes, see `deriveWatchSet`), after the set has
 * held still for a moment. An equal set does not restart the timer or send anything. The set is
 * left in place when the caller unmounts: the caller is a long-lived one, and a clear on every
 * StrictMode cleanup would be a message for nothing. It is sent again to a new client.
 */
export function useTelemetryWatch(codes: readonly string[]): void {
  const client = useTelemetryStore((s) => s.client);
  // Asset tags hold no "|", so the joined string is an exact stand-in for the list: the effect then
  // depends on what the set says, not on which array carried it.
  const wanted = codes.join('|');

  useEffect(() => {
    if (client === null) return;
    const timer = setTimeout(
      () => client.setWatch(wanted === '' ? [] : wanted.split('|')),
      WATCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [client, wanted]);
}

/**
 * Reconnects the telemetry socket now and sends the watch set again. For the "Reconnect" button;
 * it cannot restart the API's own connection to its source (V2-08.1). A no-op while no client is
 * mounted.
 */
export function retryTelemetry(): void {
  useTelemetryStore.getState().client?.retry();
}
