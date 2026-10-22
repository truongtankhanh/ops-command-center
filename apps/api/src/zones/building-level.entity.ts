import type { ZoneLevel } from '@occ/contracts';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { ZoneEntity } from './zone.entity';

/**
 * One level of a building (ADR-0023): a slab at a height, with the label operators read. Keyed by
 * building and code, so an asset's or an incident's `level_code` can point at it with a composite
 * foreign key and the database refuses a level of another building.
 */
@Entity('building_level')
export class BuildingLevelEntity {
  @PrimaryColumn({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  /** `L1`, `L2`, `B1`, `ROOF`: `LEVEL_CODE_PATTERN` (a DB CHECK). */
  @PrimaryColumn({ type: 'varchar', length: 8 })
  code: string;

  @Column({ type: 'varchar', length: 40 })
  label: string;

  /** Metres above ground of the slab: ≥ 0 (a DB CHECK). */
  @Column({ name: 'elevation_m', type: 'double precision' })
  elevationM: number;

  /** Orders the levels of one building from the lowest; unique within the building. */
  @Column({ type: 'smallint' })
  sort: number;

  @ManyToOne('ZoneEntity', 'levels', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zone_id' })
  zone?: ZoneEntity;

  toContract(): ZoneLevel {
    return { code: this.code, label: this.label, elevationM: this.elevationM };
  }
}
