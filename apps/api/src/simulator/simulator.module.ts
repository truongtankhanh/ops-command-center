import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IncidentEntity } from '../incidents/incident.entity';
import { IncidentsModule } from '../incidents/incidents.module';
import { ZoneEntity } from '../zones/zone.entity';
import { SimulatorLeader } from './simulator-leader.service';
import { SimulatorService } from './simulator.service';

@Module({
  imports: [IncidentsModule, TypeOrmModule.forFeature([IncidentEntity, ZoneEntity])],
  providers: [SimulatorService, SimulatorLeader],
  exports: [SimulatorService, SimulatorLeader],
})
export class SimulatorModule {}
