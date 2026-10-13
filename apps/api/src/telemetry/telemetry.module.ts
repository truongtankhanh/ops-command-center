import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { SitesModule } from '../sites/sites.module';
import { TelemetryIngestService } from './telemetry-ingest.service';
import { telemetrySourceProvider } from './telemetry-source.provider';

/**
 * Telemetry transport (ADR-0019): the source chosen by `TELEMETRY_SOURCE` (`mock`, `mqtt` or
 * `off`), and the ingest service that starts it, validates what it emits and holds the latest state
 * of every asset. No controller and no exports yet: the gateway (V2-06.6) will live in this module.
 * `SitesModule` is here for the MQTT source, which needs the site code for its topics.
 */
@Module({
  imports: [AssetsModule, SitesModule],
  providers: [telemetrySourceProvider, TelemetryIngestService],
})
export class TelemetryModule {}
