import type {
  IncidentSeverity,
  IncidentType,
  TelemetryComparator,
  TelemetryRule,
} from '@occ/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AssetClassEntity } from './asset-class.entity';
import { AssetEntity } from './asset.entity';

/**
 * When a reading is abnormal (ADR-0018). A class rule has no `assetId`; an override sets it and
 * replaces the class rule of the same `name` for that asset only. The database also enforces:
 * `key` is a point of the class (`fk_telemetry_rule_point`), an override's asset is of the rule's
 * class (`fk_telemetry_rule_asset`), `clear` on the safe side of `limit`, a `facilities` or
 * `environment` `incident_type`, and one rule per name per class or per asset.
 * Raw SQL must quote the `"limit"` column: it is a reserved word.
 */
@Entity('telemetry_rule')
export class TelemetryRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'asset_class_id', type: 'uuid' })
  assetClassId: string;

  @ManyToOne(() => AssetClassEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_class_id' })
  assetClass?: AssetClassEntity;

  /** `null` for a class rule. The database key is composite (`asset_id`, `asset_class_id`). */
  @Column({ name: 'asset_id', type: 'uuid', nullable: true })
  assetId: string | null;

  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** The `key` of one of the class's points. */
  @Column({ type: 'varchar', length: 63 })
  key: string;

  @Column({ type: 'varchar', length: 8 })
  comparator: TelemetryComparator;

  @Column({ type: 'double precision' })
  limit: number;

  /** The hysteresis level, on the safe side of `limit`. */
  @Column({ type: 'double precision' })
  clear: number;

  /** Seconds a breach must last before it raises an incident: ≥ 0. */
  @Column({ name: 'for_s', type: 'integer' })
  forS: number;

  @Column({ type: 'varchar', length: 16 })
  severity: IncidentSeverity;

  @Column({ name: 'incident_type', type: 'varchar', length: 32, default: 'equipment_fault' })
  incidentType: IncidentType;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** The contract's read model: no `id`, `assetId` or `enabled` (the resolver works on the entity). */
  toContract(): TelemetryRule {
    return {
      name: this.name,
      key: this.key,
      comparator: this.comparator,
      limit: this.limit,
      clear: this.clear,
      forS: this.forS,
      severity: this.severity,
      incidentType: this.incidentType,
    };
  }
}
