import { Injectable } from '@nestjs/common';
import { Counter, Registry } from '@prometheus-io/client';

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
 * Telemetry ingest metrics (ADR-0015, ADR-0019). The label is the result only: never an asset
 * code, which comes from a device and is unbounded.
 */
@Injectable()
export class TelemetryMetrics {
  private readonly messages: Counter<'result'>;

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
  }

  countMessage(result: TelemetryMessageResult): void {
    this.messages.inc({ result });
  }
}
