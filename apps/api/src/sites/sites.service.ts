import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { SitePlan } from '@occ/contracts';
import { Repository } from 'typeorm';
import { EntityNotFoundError } from '../common/domain-errors';
import { SiteEntity } from './site.entity';

@Injectable()
export class SitesService {
  constructor(@InjectRepository(SiteEntity) private readonly sites: Repository<SiteEntity>) {}

  /**
   * The plan of the one site this deployment serves. Until zones belong to a site, a second site
   * row would not be reachable: the first by `code` wins, so the answer is at least stable.
   */
  async getPlan(): Promise<SitePlan> {
    const [site] = await this.sites.find({
      relations: { features: true },
      order: { code: 'ASC' },
      take: 1,
    });
    if (!site) throw new EntityNotFoundError('Site plan');
    return site.toContract();
  }
}
