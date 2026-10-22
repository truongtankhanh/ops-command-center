import type { Asset } from '@occ/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ZoneEntity } from '../zones/zone.entity';
import { AssetClassEntity } from './asset-class.entity';

/**
 * A piece of equipment or a sensor at a fixed place on the site (ADR-0018). Its readings are not
 * stored here, and nothing in the API writes it: rows come from the seed.
 */
@Entity('asset')
export class AssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The operators' tag, pattern enforced by a DB CHECK (`asset_code_check`).
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index()
  @Column({ name: 'asset_class_id', type: 'uuid' })
  assetClassId: string;

  @ManyToOne(() => AssetClassEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asset_class_id' })
  assetClass?: AssetClassEntity;

  @Index()
  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  @ManyToOne(() => ZoneEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'zone_id' })
  zone?: ZoneEntity;

  @Column({ type: 'double precision' })
  lng: number;

  @Column({ type: 'double precision' })
  lat: number;

  /** Metres of the base above ground: ≥ 0 (a DB CHECK). A roof is the building's height. */
  @Column({ name: 'elevation_m', type: 'double precision' })
  elevationM: number;

  /** Degrees clockwise from true north, `0 ≤ x < 360` (a DB CHECK). */
  @Column({ name: 'heading_deg', type: 'double precision' })
  headingDeg: number;

  /**
   * One of the zone's levels (ADR-0023); `null` when the asset has none. A plain column on purpose:
   * the database enforces the key (`fk_asset_level`, composite with `zone_id`), so a level of
   * another building is refused.
   */
  @Column({ name: 'level_code', type: 'varchar', length: 8, nullable: true })
  levelCode: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  toContract(): Asset {
    // A class may have no headline point, so an unloaded relation must not pass for an empty list.
    if (!this.assetClass?.points) {
      throw new Error('AssetEntity.toContract() needs the `assetClass` relation with its `points`');
    }
    const headline = this.assetClass.points
      .filter((point) => point.headline !== null)
      .sort((a, b) => (a.headline ?? 0) - (b.headline ?? 0))
      .map((point) => point.toContract());
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      class: this.assetClass.toContract(),
      zoneId: this.zoneId,
      position: [this.lng, this.lat],
      elevationM: this.elevationM,
      headingDeg: this.headingDeg,
      levelCode: this.levelCode,
      headline,
    };
  }
}
