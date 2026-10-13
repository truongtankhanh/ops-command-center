import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetsService } from '../assets/assets.service';
import type { Env } from '../config/env.validation';
import { MockTelemetrySource } from './mock-telemetry-source';
import { OffTelemetrySource } from './off-telemetry-source';
import type { TelemetrySource } from './telemetry-source';

export const TELEMETRY_SOURCE = Symbol('TELEMETRY_SOURCE');

/**
 * Chooses the telemetry source once, at startup, from `TELEMETRY_SOURCE` (see ADR-0019). It only
 * constructs: starting the source is its consumer's job, so the choice costs nothing until one
 * exists.
 */
export const telemetrySourceProvider: Provider<TelemetrySource> = {
  provide: TELEMETRY_SOURCE,
  inject: [ConfigService, AssetsService],
  useFactory: (config: ConfigService<Env, true>, assets: AssetsService): TelemetrySource => {
    const kind = config.getOrThrow('TELEMETRY_SOURCE', { infer: true });
    switch (kind) {
      case 'mock':
        return new MockTelemetrySource(() => assets.catalogue());
      case 'off':
        return new OffTelemetrySource();
      default: {
        // A value added to `Env` without a source here fails to compile, not at boot.
        const unhandled: never = kind;
        throw new Error(`No telemetry source for TELEMETRY_SOURCE=${String(unhandled)}`);
      }
    }
  },
};
