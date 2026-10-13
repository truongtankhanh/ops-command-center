import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsGateway } from './events.gateway';
import { SocketAuth } from './socket-auth';

@Module({ imports: [AuthModule], providers: [EventsGateway, SocketAuth] })
export class RealtimeModule {}
