import type { TelemetryPoint, TelemetryPointKind } from '@occ/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { AssetClassEntity } from './asset-class.entity';

/**
 * One thing an asset class measures or reports (ADR-0018). Defined by the class, not by each
 * asset. The database also enforces: the key pattern, `min <= max`, `enum_values` set exactly for
 * an `enum` as a non-empty array, `headline` 1 or 2 and unique per class where set.
 */
@Entity('telemetry_point')
@Unique('uq_telemetry_point_class_key', ['assetClassId', 'key'])
export class TelemetryPointEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Indexed through `uq_telemetry_point_class_key`, which leads with it.
  @Column({ name: 'asset_class_id', type: 'uuid' })
  assetClassId: string;

  @ManyToOne('AssetClassEntity', 'points', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_class_id' })
  assetClass?: AssetClassEntity;

  /** camelCase, unique within the class: `motorTempC`. */
  @Column({ type: 'varchar', length: 63 })
  key: string;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  unit: string | null;

  @Column({ type: 'varchar', length: 16 })
  kind: TelemetryPointKind;

  /** Valid range of a `number` point; `null` is no bound. A reading outside it is dropped. */
  @Column({ type: 'double precision', nullable: true })
  min: number | null;

  @Column({ type: 'double precision', nullable: true })
  max: number | null;

  @Column({ name: 'enum_values', type: 'jsonb', nullable: true })
  enumValues: string[] | null;

  @Column({ name: 'expected_interval_s', type: 'integer' })
  expectedIntervalS: number;

  /** Rank 1 or 2 among the class's headline points; `null` when the point is not one. */
  @Column({ type: 'smallint', nullable: true })
  headline: 1 | 2 | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  toContract(): TelemetryPoint {
    return {
      key: this.key,
      label: this.label,
      unit: this.unit,
      kind: this.kind,
      min: this.min,
      max: this.max,
      enumValues: this.enumValues,
      expectedIntervalS: this.expectedIntervalS,
      headline: this.headline,
    };
  }
}
