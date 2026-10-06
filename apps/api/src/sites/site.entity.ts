import type { LngLat, SitePlan } from '@occ/contracts';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { SiteFeatureEntity } from './site-feature.entity';

/** A campus: what is drawn under its zones (ADR-0017). Zones do not reference it yet. */
@Entity('site')
export class SiteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'center_lng', type: 'double precision' })
  centerLng: number;

  @Column({ name: 'center_lat', type: 'double precision' })
  centerLat: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => SiteFeatureEntity, (feature) => feature.site)
  features?: SiteFeatureEntity[];

  get center(): LngLat {
    return [this.centerLng, this.centerLat];
  }

  toContract(): SitePlan {
    // A site may have no features, so an unloaded relation must not pass for an empty plan.
    if (!this.features) throw new Error('SiteEntity.toContract() needs the `features` relation');
    const features = [...this.features].sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      center: this.center,
      features: features.map((feature) => feature.toContract()),
    };
  }
}
