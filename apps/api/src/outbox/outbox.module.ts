import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxListener } from './outbox-listener.service';
import { OutboxRelay } from './outbox-relay.service';
import { OutboxEntity } from './outbox.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEntity])],
  providers: [OutboxRelay, OutboxListener],
  exports: [OutboxRelay],
})
export class OutboxModule {}
