import type { LngLat, Zone, ZoneKind, ZoneUse } from '@occ/contracts';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BuildingLevelEntity } from './building-level.entity';

@Entity('zone')
export class ZoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  kind: ZoneKind;

  @Column({ type: 'varchar', length: 16, nullable: true })
  use: ZoneUse | null;

  @Column({ name: 'height_m', type: 'double precision', nullable: true })
  heightM: number | null;

  @Column({ type: 'jsonb' })
  polygon: LngLat[];

  @Column({ name: 'center_lng', type: 'double precision' })
  centerLng: number;

  @Column({ name: 'center_lat', type: 'double precision' })
  centerLat: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** A building's levels (ADR-0023). Loaded for reads only; nothing writes them through the entity. */
  @OneToMany(() => BuildingLevelEntity, (level) => level.zone)
  levels?: BuildingLevelEntity[];

  get center(): LngLat {
    return [this.centerLng, this.centerLat];
  }

  toContract(): Zone {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      kind: this.kind,
      use: this.use,
      heightM: this.heightM,
      // Only when the relation is loaded: an unloaded relation must not pass for "no levels".
      ...(this.levels && {
        levels: [...this.levels].sort((a, b) => a.sort - b.sort).map((level) => level.toContract()),
      }),
      polygon: this.polygon,
      center: this.center,
    };
  }
}
