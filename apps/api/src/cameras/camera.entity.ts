import type { Camera, CameraFieldOfView } from '@occ/contracts';
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

  // Field of view: all three set, or all null when the orientation is unknown (a DB CHECK).
  @Column({ name: 'fov_heading_deg', type: 'double precision', nullable: true })
  fovHeadingDeg: number | null;

  @Column({ name: 'fov_angle_deg', type: 'double precision', nullable: true })
  fovAngleDeg: number | null;

  @Column({ name: 'fov_range_m', type: 'double precision', nullable: true })
  fovRangeM: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  get fieldOfView(): CameraFieldOfView | null {
    if (this.fovHeadingDeg === null || this.fovAngleDeg === null || this.fovRangeM === null) {
      return null;
    }
    return { heading: this.fovHeadingDeg, angle: this.fovAngleDeg, range: this.fovRangeM };
  }

  toContract(): Camera {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      zoneId: this.zoneId,
      position: [this.lng, this.lat],
      online: this.online,
      fieldOfView: this.fieldOfView,
    };
  }

  toRef(): CameraRef {
    return { id: this.id, code: this.code, name: this.name, streamPath: this.streamPath };
  }
}
