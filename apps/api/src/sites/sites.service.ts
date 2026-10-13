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

  /**
   * The code of the site this deployment serves, for a reader that needs nothing else of it (the
   * MQTT topics, ADR-0019). The same row `getPlan()` picks, so the two never disagree about which
   * site it is. `null` while there is no row: a fresh database is seeded after most modules start,
   * and the reader asks again.
   */
  async siteCode(): Promise<string | null> {
    const [site] = await this.sites.find({
      select: { code: true },
      order: { code: 'ASC' },
      take: 1,
    });
    return site?.code ?? null;
  }
}
