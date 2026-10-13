import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsGateway } from './events.gateway';
import { SocketAuth } from './socket-auth';

// `SocketAuth` is exported for `/telemetry`: one implementation of the handshake rules for every
// namespace, so a security control cannot drift between them (ADR-0019).
@Module({
  imports: [AuthModule],
  providers: [EventsGateway, SocketAuth],
  exports: [SocketAuth],
})
export class RealtimeModule {}
