import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SitesModule } from '../sites/sites.module';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryIngestService } from './telemetry-ingest.service';
import { telemetrySourceProvider } from './telemetry-source.provider';

/**
 * Telemetry transport (ADR-0019): the source chosen by `TELEMETRY_SOURCE` (`mock`, `mqtt` or
 * `off`), the ingest service that starts it, validates what it emits and holds the latest state of
 * every asset, and the `/telemetry` gateway that serves that state to consoles. No controller and
 * no exports. `SitesModule` is here for the MQTT source, which needs the site code for its topics;
 * `RealtimeModule` for the gateway's handshake (`SocketAuth`).
 */
@Module({
  imports: [AssetsModule, SitesModule, RealtimeModule],
  providers: [telemetrySourceProvider, TelemetryIngestService, TelemetryGateway],
})
export class TelemetryModule {}
