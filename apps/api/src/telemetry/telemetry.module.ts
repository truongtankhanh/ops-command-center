import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SitesModule } from '../sites/sites.module';
import { RuleEvaluator } from './rule-evaluator.service';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryIngestService } from './telemetry-ingest.service';
import { TelemetryLeader } from './telemetry-leader.service';
import { TelemetrySamplePartitions } from './telemetry-sample-partitions.service';
import { TelemetrySampleWriter } from './telemetry-sample-writer.service';
import { telemetrySourceProvider } from './sources/telemetry-source.provider';

/**
 * Telemetry transport (ADR-0019): the source chosen by `TELEMETRY_SOURCE` (`mock`, `mqtt` or
 * `off`), the ingest service that starts it, validates what it emits and holds the latest state of
 * every asset, the `/telemetry` gateway that serves that state to consoles, the leader that
 * says which replica does the work that must happen once, and what that replica does with the lead:
 * the reading history and its partitions, and the threshold rules that turn a sustained breach
 * into an incident. No controller and no exports.
 * `SitesModule` is here for the MQTT source, which needs the site code for its topics;
 * `RealtimeModule` for the gateway's handshake (`SocketAuth`); `IncidentsModule` for the evaluator,
 * which raises through `IncidentsService` like any other writer (ADR-0007, ADR-0018).
 */
@Module({
  imports: [AssetsModule, IncidentsModule, SitesModule, RealtimeModule],
  providers: [
    telemetrySourceProvider,
    TelemetryIngestService,
    TelemetryGateway,
    TelemetryLeader,
    TelemetrySamplePartitions,
    TelemetrySampleWriter,
    RuleEvaluator,
  ],
})
export class TelemetryModule {}
