import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { collectDefaultMetrics, Registry } from '@prometheus-io/client';
import type { Env } from '../config/env.validation';
import { SERVICE } from '../logging/logger-options';
import { HttpMetrics } from './http-metrics.middleware';
import { MetricsServer } from './metrics-server';
import { RealtimeMetrics } from './realtime.metrics';

/**
 * The app's one metrics registry (ADR-0015). `service` and `env` label every series with the
 * values of the log fields of the same name, so a metric and its log lines filter alike.
 */
function createRegistry(config: ConfigService<Env, true>): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({
    service: SERVICE,
    env: config.get('DEPLOYMENT_ENV', { infer: true }),
  });
  // Event-loop lag, heap, GC, handles and CPU, read on each scrape.
  collectDefaultMetrics({ register: registry });
  return registry;
}

/**
 * Metrics for Prometheus (ADR-0015). Every metric is registered on the `Registry` provided here,
 * never on the library's global `register`: the e2e suite boots several apps in one process, and a
 * name registered twice on a shared registry throws.
 */
@Global()
@Module({
  providers: [
    { provide: Registry, inject: [ConfigService], useFactory: createRegistry },
    MetricsServer,
    HttpMetrics,
    RealtimeMetrics,
  ],
  exports: [Registry, RealtimeMetrics],
})
export class MetricsModule {}
