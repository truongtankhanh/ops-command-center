import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxModule } from '../outbox/outbox.module';
import { IdempotencyKeyCleanup } from './idempotency-key-cleanup.service';
import { IdempotencyKeyEntity } from './idempotency-key.entity';
import { IncidentEventEntity } from './incident-event.entity';
import { IncidentEntity } from './incident.entity';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([IncidentEntity, IncidentEventEntity, IdempotencyKeyEntity]),
    OutboxModule,
  ],
  controllers: [IncidentsController],
  providers: [IncidentsService, IdempotencyKeyCleanup],
  exports: [IncidentsService],
})
export class IncidentsModule {}
