import { readFileSync } from 'node:fs';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetsService } from '../assets/assets.service';
import type { Env } from '../config/env.validation';
import { SitesService } from '../sites/sites.service';
import { MockTelemetrySource } from './mock-telemetry-source';
import { MqttTelemetrySource } from './mqtt-telemetry-source';
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
  inject: [ConfigService, AssetsService, SitesService],
  useFactory: (
    config: ConfigService<Env, true>,
    assets: AssetsService,
    sites: SitesService,
  ): TelemetrySource => {
    const kind = config.getOrThrow('TELEMETRY_SOURCE', { infer: true });
    switch (kind) {
      case 'mock':
        return new MockTelemetrySource(() => assets.catalogue());
      case 'mqtt':
        return new MqttTelemetrySource({
          url: config.getOrThrow('MQTT_URL', { infer: true }),
          username: config.get('MQTT_USERNAME', { infer: true }),
          password: config.get('MQTT_PASSWORD', { infer: true }),
          ca: readCaFile(config.get('MQTT_CA_FILE', { infer: true })),
          loadSiteCode: () => sites.siteCode(),
        });
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

/**
 * Read once, when the source is built, so a missing or unreadable file fails boot naming the
 * variable and the path, rather than surfacing as a TLS error on the first connection. Only the
 * path and the error code are in the message: neither is a secret.
 */
function readCaFile(path: string | undefined): Buffer | undefined {
  if (path === undefined) return undefined;
  try {
    return readFileSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    throw new Error(`MQTT_CA_FILE: cannot read ${path} (${code})`);
  }
}
