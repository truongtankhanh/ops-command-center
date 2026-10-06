import type { SiteFeature, SiteFeaturePart, SiteGeometry } from '@occ/contracts';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { SiteEntity } from './site.entity';

/** One drawn part of a site plan: a boundary, a road or a field marking. */
@Entity('site_feature')
@Unique('site_feature_site_order_key', ['siteId', 'sortOrder'])
export class SiteFeatureEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Indexed through `site_feature_site_order_key`, which leads with it.
  @Column({ name: 'site_id', type: 'uuid' })
  siteId: string;

  @ManyToOne('SiteEntity', 'features', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'site_id' })
  site?: SiteEntity;

  @Column({ type: 'varchar', length: 16 })
  part: SiteFeaturePart;

  @Column({ type: 'jsonb' })
  geometry: SiteGeometry;

  /** Drawing order within the site, lowest first. */
  @Column({ name: 'sort_order', type: 'smallint' })
  sortOrder: number;

  toContract(): SiteFeature {
    return { part: this.part, geometry: this.geometry };
  }
}
