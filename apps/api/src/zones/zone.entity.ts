import type { LngLat, Zone, ZoneKind } from '@occ/contracts';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

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

  @Column({ type: 'jsonb' })
  polygon: LngLat[];

  @Column({ name: 'center_lng', type: 'double precision' })
  centerLng: number;

  @Column({ name: 'center_lat', type: 'double precision' })
  centerLat: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  get center(): LngLat {
    return [this.centerLng, this.centerLat];
  }

  toContract(): Zone {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      kind: this.kind,
      polygon: this.polygon,
      center: this.center,
    };
  }
}
