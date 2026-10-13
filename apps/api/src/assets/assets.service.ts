import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Asset, AssetDetail, TelemetryPoint } from '@occ/contracts';
import { type FindOptionsRelations, IsNull, Repository } from 'typeorm';
import { EntityNotFoundError } from '../common/domain-errors';
import { AssetEntity } from './asset.entity';
import { orderPoints, type ResolvableRule, resolveAssetRules } from './asset-resolution';
import { TelemetryRuleEntity } from './telemetry-rule.entity';

/** What `AssetEntity.toContract()` needs: it throws, and a request would `500`, without it. */
const WITH_CLASS_AND_POINTS: FindOptionsRelations<AssetEntity> = { assetClass: { points: true } };

/**
 * An asset as the telemetry bridge and the rule evaluator need it: all the points of its class and
 * the rules that apply to it, with nothing a client sees (position, class model, headline).
 */
export interface CatalogueAsset {
  id: string;
  code: string;
  /** Every point of the asset's class, headline points first (`orderPoints`). */
  points: TelemetryPoint[];
  /**
   * The enabled rules that apply to this asset after its overrides (`resolveAssetRules`). Kept as
   * rows, not the contract's `TelemetryRule`, because raising an incident needs the rule's `id`.
   */
  rules: ResolvableRule[];
}

/**
 * Reads of the equipment catalogue (ADR-0018). Nothing here writes: assets, points and rules come
 * from the seed or from a reviewed database change, and the API has no command path to a device.
 */
@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(AssetEntity) private readonly assets: Repository<AssetEntity>,
    @InjectRepository(TelemetryRuleEntity) private readonly rules: Repository<TelemetryRuleEntity>,
  ) {}

  /** Every asset ordered by code, with its class and headline points, in one statement. */
  async list(): Promise<Asset[]> {
    const assets = await this.assets.find({
      relations: WITH_CLASS_AND_POINTS,
      order: { code: 'ASC' },
    });
    return assets.map((asset) => asset.toContract());
  }

  /**
   * One asset by its code, with all the points of its class and the rules that apply to it
   * (`resolveAssetRules`).
   */
  async get(code: string): Promise<AssetDetail> {
    // `find`, not `findOne`: `findOne` adds `take: 1`, which TypeORM answers over a joined
    // one-to-many with a separate statement for the ids first. `code` is unique, so `find` returns
    // at most one row, in one statement.
    const [asset] = await this.assets.find({
      where: { code },
      relations: WITH_CLASS_AND_POINTS,
    });
    if (!asset) throw new EntityNotFoundError('Asset', code);

    // Before the rules read: an unloaded relation fails here, not after a second round trip.
    const summary = asset.toContract();
    // All rules of the class that apply to this asset, disabled ones included: whether a disabled
    // override silences a rule is decided by `resolveAssetRules`, not by this query.
    const rules = await this.rules.find({
      where: [
        { assetClassId: asset.assetClassId, assetId: IsNull() },
        { assetClassId: asset.assetClassId, assetId: asset.id },
      ],
    });

    return {
      ...summary,
      points: orderPoints(asset.assetClass?.points ?? []).map((point) => point.toContract()),
      rules: resolveAssetRules(asset.id, rules).map((rule) => rule.toContract()),
    };
  }

  /**
   * Every asset with all the points of its class and the rules that apply to it, in two statements
   * whatever the number of assets (`get()` does the same for one, with a statement per call).
   * Readers that need the whole catalogue go through here, so which override wins is decided in
   * one place. Ordered by code.
   */
  async catalogue(): Promise<CatalogueAsset[]> {
    const assets = await this.assets.find({
      relations: WITH_CLASS_AND_POINTS,
      order: { code: 'ASC' },
    });
    // Every rule, disabled ones included: `resolveAssetRules` decides which one silences which.
    const rules = await this.rules.find();

    const rulesByClass = new Map<string, TelemetryRuleEntity[]>();
    for (const rule of rules) {
      const ofClass = rulesByClass.get(rule.assetClassId);
      if (ofClass) ofClass.push(rule);
      else rulesByClass.set(rule.assetClassId, [rule]);
    }

    return assets.map((asset) => ({
      id: asset.id,
      code: asset.code,
      points: orderPoints(asset.assetClass?.points ?? []).map((point) => point.toContract()),
      rules: resolveAssetRules(asset.id, rulesByClass.get(asset.assetClassId) ?? []),
    }));
  }
}
