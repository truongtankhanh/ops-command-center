import { Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { OutboxListener } from '../outbox/outbox-listener.service';

/**
 * Readiness of this replica's `LISTEN` connection (ADR-0008). Reads state the listener already
 * tracks, so it costs no database round trip.
 */
@Injectable()
export class OutboxListenerHealthIndicator {
  constructor(
    private readonly listener: OutboxListener,
    private readonly indicator: HealthIndicatorService,
  ) {}

  isHealthy<const Key extends string>(key: Key): HealthIndicatorResult<Key> {
    const check = this.indicator.check(key);
    return this.listener.isListening() ? check.up() : check.down('not listening');
  }
}
