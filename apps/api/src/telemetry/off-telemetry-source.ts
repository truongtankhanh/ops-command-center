import { Logger } from '@nestjs/common';
import { ListenerSet } from './listener-set';
import type { RawReading, TelemetrySource, Unsubscribe, UpstreamState } from './telemetry-source';

/**
 * No telemetry (`TELEMETRY_SOURCE=off`): it emits no reading, so the twin shows assets with no
 * readings (ADR-0019). Its upstream is `live`: no consumer is waiting on a connection that could
 * be down, so reporting `paused` would only put "Telemetry paused" on every console.
 */
export class OffTelemetrySource implements TelemetrySource {
  readonly kind = 'off';
  private readonly upstream = new ListenerSet<UpstreamState>(new Logger(OffTelemetrySource.name));

  async start(): Promise<void> {
    this.upstream.notify({ upstream: 'live', since: new Date().toISOString() });
  }

  async stop(): Promise<void> {
    // Nothing is held, so there is nothing to release.
  }

  /** Never called back: this source has no readings. */
  onReading(_listener: (reading: RawReading) => void): Unsubscribe {
    return () => undefined;
  }

  onUpstream(listener: (state: UpstreamState) => void): Unsubscribe {
    return this.upstream.add(listener);
  }
}
