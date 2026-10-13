import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry } from '@prometheus-io/client';

/**
 * What became of one reading (ADR-0019, "Validation in the bridge"). A reading has one result, by
 * precedence: `unknown_asset`, then `invalid` (any value dropped, or no usable values), then
 * `clock_skew` (its `at` was replaced), then `accepted`.
 */
export const TELEMETRY_MESSAGE_RESULTS = [
  'accepted',
  'unknown_asset',
  'invalid',
  'clock_skew',
] as const;
export type TelemetryMessageResult = (typeof TELEMETRY_MESSAGE_RESULTS)[number];

/**
 * Telemetry metrics (ADR-0015, ADR-0019). The only label is the result of a reading: never an
 * asset code, which comes from a device and is unbounded. The two gauges have no label.
 */
@Injectable()
export class TelemetryMetrics {
  private readonly messages: Counter<'result'>;
  private countConsoles?: () => number;
  private isUpstreamLive?: () => boolean;

  constructor(registry: Registry) {
    this.messages = new Counter({
      name: 'telemetry_messages_total',
      help:
        'Readings received from the telemetry source, by result. One count per reading: a reading ' +
        'with a dropped value is `invalid` and its other values are still applied. Precedence: ' +
        'unknown_asset, invalid, clock_skew, accepted.',
      labelNames: ['result'],
      registers: [registry],
    });
    // Present from the first scrape, so `increase()` and alerts see a series before its first drop.
    for (const result of TELEMETRY_MESSAGE_RESULTS) this.messages.inc({ result }, 0);

    // Both gauges are read on each scrape rather than set on every change, so a missed
    // disconnect or a missed state change cannot leave them wrong (as `realtime_connected_consoles`).
    const consoles: Gauge = new Gauge({
      name: 'telemetry_connected_consoles',
      help: 'Consoles connected to the telemetry namespace on this replica.',
      registers: [registry],
      collect: () => consoles.set(this.countConsoles?.() ?? 0),
    });
    const upstream: Gauge = new Gauge({
      name: 'telemetry_upstream_up',
      help:
        '1 when this replica reports its telemetry source live, 0 when paused. The `off` source ' +
        'reports live by design, so 1 does not mean readings are flowing.',
      registers: [registry],
      collect: () => upstream.set(this.isUpstreamLive?.() ? 1 : 0),
    });
  }

  countMessage(result: TelemetryMessageResult): void {
    this.messages.inc({ result });
  }

  /** Called by `TelemetryGateway` once its namespace exists. */
  trackConsoles(count: () => number): void {
    this.countConsoles = count;
  }

  /** Called by `TelemetryIngestService`, which is the one that holds the upstream state. */
  trackUpstream(isLive: () => boolean): void {
    this.isUpstreamLive = isLive;
  }
}
