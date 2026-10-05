import { Injectable } from '@nestjs/common';
import { Gauge, Histogram, Registry } from '@prometheus-io/client';
import type { OutboxEventName } from '../outbox/outbox.entity';

/** Around the quality goal: a new incident reaches every open console in under a second. */
const DELIVERY_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 5, 10];

/**
 * Real-time delivery metrics (ADR-0015, IMP-14). Labels are the event name only: never an
 * incident, outbox row or socket id.
 */
@Injectable()
export class RealtimeMetrics {
  private readonly delivery: Histogram<'event'>;
  private countConsoles?: () => number;

  constructor(registry: Registry) {
    this.delivery = new Histogram({
      name: 'incident_event_delivery_seconds',
      help:
        'Time from the outbox row being written to its broadcast on this replica. Measured from ' +
        'the transaction start (created_at), so it includes the rest of the writing transaction.',
      labelNames: ['event'],
      buckets: DELIVERY_BUCKETS,
      registers: [registry],
    });
    // Read on each scrape rather than counted up and down, so a missed disconnect cannot skew it.
    const consoles: Gauge = new Gauge({
      name: 'realtime_connected_consoles',
      help: 'Consoles connected to the events namespace on this replica.',
      registers: [registry],
      collect: () => consoles.set(this.countConsoles?.() ?? 0),
    });
  }

  /** Called by `EventsGateway` once its namespace exists. */
  trackConsoles(count: () => number): void {
    this.countConsoles = count;
  }

  /**
   * `createdAt` is the database clock and now is this process's: skew between hosts adds error, so
   * a negative result is recorded as zero.
   */
  observeDelivery(event: OutboxEventName, createdAt: Date): void {
    this.delivery.observe({ event }, Math.max(0, (Date.now() - createdAt.getTime()) / 1000));
  }
}
