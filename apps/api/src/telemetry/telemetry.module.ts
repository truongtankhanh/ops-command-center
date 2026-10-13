import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { telemetrySourceProvider } from './telemetry-source.provider';

/**
 * Telemetry transport (ADR-0019). It holds the source and nothing else yet: no controller, and
 * nothing starts the source, so enabling the module changes no behaviour.
 */
@Module({
  imports: [AssetsModule],
  providers: [telemetrySourceProvider],
})
export class TelemetryModule {}
