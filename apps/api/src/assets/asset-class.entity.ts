import type { AssetClass } from '@occ/contracts';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TelemetryPointEntity } from './telemetry-point.entity';

/** Where the model files are served from (ADR-0020); a class's `model_key` is the file name. */
export const ASSET_MODEL_URL_PREFIX = '/models/';

/**
 * A kind of equipment, such as a cooling tower: what it measures (its points) and how it is drawn.
 * Its assets share this definition (ADR-0018).
 */
@Entity('asset_class')
export class AssetClassEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Lower snake case, pattern enforced by a DB CHECK (`asset_class_code_check`).
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** The model file (ADR-0020). `null`: clients draw a neutral box from the footprint. */
  @Column({ name: 'model_key', type: 'varchar', length: 64, nullable: true })
  modelKey: string | null;

  // Metres, each > 0 (a DB CHECK).
  @Column({ name: 'footprint_w_m', type: 'double precision' })
  footprintWM: number;

  @Column({ name: 'footprint_d_m', type: 'double precision' })
  footprintDM: number;

  @Column({ name: 'footprint_h_m', type: 'double precision' })
  footprintHM: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => TelemetryPointEntity, (point) => point.assetClass)
  points?: TelemetryPointEntity[];

  toContract(): AssetClass {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      modelUrl: this.modelKey === null ? null : `${ASSET_MODEL_URL_PREFIX}${this.modelKey}`,
      footprintM: { width: this.footprintWM, depth: this.footprintDM, height: this.footprintHM },
    };
  }
}
