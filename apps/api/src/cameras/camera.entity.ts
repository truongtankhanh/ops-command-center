import type { Camera } from '@occ/contracts';
import type { CameraRef } from '@occ/camera-adapter';
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

@Entity('camera')
export class CameraEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

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

  /** Path of this camera's stream on the media server. */
  @Column({ name: 'stream_path', type: 'varchar', length: 255 })
  streamPath: string;

  @Column({ type: 'boolean', default: true })
  online: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  toContract(): Camera {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      zoneId: this.zoneId,
      position: [this.lng, this.lat],
      online: this.online,
    };
  }

  toRef(): CameraRef {
    return { id: this.id, code: this.code, name: this.name, streamPath: this.streamPath };
  }
}
