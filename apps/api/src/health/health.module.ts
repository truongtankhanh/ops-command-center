import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { OutboxModule } from '../outbox/outbox.module';
import { HealthController } from './health.controller';
import { OutboxListenerHealthIndicator } from './outbox-listener.health';

/**
 * Liveness and readiness probes (ADR-0013). Terminus' own logger is off: it logs every failed
 * check, while `HealthController` logs only when readiness changes. On shutdown, Terminus reports
 * `shutting_down` (503) from `beforeApplicationShutdown`, before the HTTP server closes.
 */
@Module({
  imports: [TerminusModule.forRoot({ logger: false }), OutboxModule],
  controllers: [HealthController],
  providers: [OutboxListenerHealthIndicator],
})
export class HealthModule {}
