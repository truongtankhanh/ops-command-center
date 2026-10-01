import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Zone } from '@occ/contracts';
import { Repository } from 'typeorm';
import { EntityNotFoundError } from '../common/domain-errors';
import { ZoneEntity } from './zone.entity';

@Injectable()
export class ZonesService {
  constructor(@InjectRepository(ZoneEntity) private readonly zones: Repository<ZoneEntity>) {}

  async list(): Promise<Zone[]> {
    const zones = await this.zones.find({ order: { name: 'ASC' } });
    return zones.map((zone) => zone.toContract());
  }

  async getEntity(id: string): Promise<ZoneEntity> {
    const zone = await this.zones.findOneBy({ id });
    if (!zone) throw new EntityNotFoundError('Zone', id);
    return zone;
  }

  /** All zones as entities — used by the simulator to pick locations. */
  findAllEntities(): Promise<ZoneEntity[]> {
    return this.zones.find();
  }
}
