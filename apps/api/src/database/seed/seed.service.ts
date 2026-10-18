import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CameraFieldOfView } from '@occ/contracts';
import { DataSource, type EntityManager, In, IsNull, Or } from 'typeorm';
import { AssetClassEntity } from '../../assets/asset-class.entity';
import { AssetEntity } from '../../assets/asset.entity';
import { TelemetryPointEntity } from '../../assets/telemetry-point.entity';
import { TelemetryRuleEntity } from '../../assets/telemetry-rule.entity';
import { CameraEntity } from '../../cameras/camera.entity';
import { offset } from '../../common/geo';
import type { Env } from '../../config/env.validation';
import { SystemActors } from '../../incidents/actors';
import { nextIncidentCode } from '../../incidents/incident-code';
import { IncidentEntity } from '../../incidents/incident.entity';
import { persistIncident } from '../../incidents/persist-incident';
import { SiteFeatureEntity } from '../../sites/site-feature.entity';
import { SiteEntity } from '../../sites/site.entity';
import { ZoneEntity } from '../../zones/zone.entity';
import { AdvisoryLocks } from '../advisory-locks';
import {
  ASSET_CLASSES,
  missingFromCatalogue,
  pointRef,
  ruleRef,
  SUPERSEDED_MODEL_KEYS,
  type ClassSeed,
  type PointSeed,
  type PresentCatalogue,
  type RuleSeed,
} from './asset-catalogue';
import { ASSETS, type AssetSeed } from './assets';
import {
  CAMERAS,
  CAMPUS_CENTER,
  INCIDENTS,
  REFERENCE_ZONE_CODES,
  SITE,
  siteFeatures,
  ZONES,
  zoneCenter,
  zonePolygon,
  type CameraSeed,
  type ZoneSeed,
} from './campus';

const MINUTE = 60_000;

const SEED_ZONE_CODES = ZONES.map((zone) => zone.code);
const SEED_CAMERA_CODES = CAMERAS.map((camera) => camera.code);
const SEED_CLASS_CODES = ASSET_CLASSES.map((assetClass) => assetClass.code);
const SEED_ASSET_CODES = ASSETS.map((asset) => asset.code);
// The seed zones whose use and height the seed owns. They are buildings (`campus.spec.ts` pins it).
const USE_SEED_CODES = ZONES.filter((zone) => zone.use !== undefined).map((zone) => zone.code);
const HEIGHT_SEED_CODES = ZONES.filter((zone) => zone.heightM !== undefined).map(
  (zone) => zone.code,
);

const zoneColumns = (seed: ZoneSeed) => {
  const [centerLng, centerLat] = zoneCenter(seed);
  return {
    code: seed.code,
    name: seed.name,
    kind: seed.kind,
    use: seed.use ?? null,
    heightM: seed.heightM ?? null,
    polygon: zonePolygon(seed),
    centerLng,
    centerLat,
  };
};

const fieldOfViewColumns = ({ heading, angle, range }: CameraFieldOfView) => ({
  fovHeadingDeg: heading,
  fovAngleDeg: angle,
  fovRangeM: range,
});

/** A seed camera's row in `zone`: one definition for a fresh seed and a top-up, so they agree. */
const cameraColumns = (seed: CameraSeed, zone: ZoneEntity) => {
  const [lng, lat] = offset(zone.center, ...seed.at);
  return {
    code: seed.code,
    name: seed.name,
    zoneId: zone.id,
    lng,
    lat,
    streamPath: `campus/${seed.code.toLowerCase()}`,
    online: seed.online ?? true,
    ...fieldOfViewColumns(seed.fov),
  };
};

/** A catalogue row's columns: one definition for a fresh seed and a top-up, so they agree. */
const classColumns = (seed: ClassSeed) => ({
  code: seed.code,
  name: seed.name,
  modelKey: seed.modelKey,
  footprintWM: seed.footprintM.width,
  footprintDM: seed.footprintM.depth,
  footprintHM: seed.footprintM.height,
});

const pointColumns = (seed: PointSeed, assetClassId: string) => ({
  assetClassId,
  key: seed.key,
  label: seed.label,
  unit: seed.unit,
  kind: seed.kind,
  min: seed.min,
  max: seed.max,
  enumValues: seed.enumValues,
  expectedIntervalS: seed.expectedIntervalS,
  headline: seed.headline,
});

/** A class rule: `assetId` is `null`, an override is never seeded. */
const ruleColumns = (seed: RuleSeed, assetClassId: string) => ({
  assetClassId,
  assetId: null,
  name: seed.name,
  key: seed.key,
  comparator: seed.comparator,
  limit: seed.limit,
  clear: seed.clear,
  forS: seed.forS,
  severity: seed.severity,
  incidentType: seed.incidentType,
  enabled: true,
});

/**
 * A seed asset's row: one definition for a fresh seed and a top-up, so they agree. `at` is metres
 * from the campus centre, not from the zone as a camera's is, so the offset starts there.
 */
const assetColumns = (seed: AssetSeed, assetClassId: string, zoneId: string) => {
  const [lng, lat] = offset(CAMPUS_CENTER, ...seed.at);
  return {
    code: seed.code,
    name: seed.name,
    assetClassId,
    zoneId,
    lng,
    lat,
    elevationM: seed.elevationM,
    headingDeg: seed.headingDeg,
  };
};

/** What the catalogue step inserted. */
interface CatalogueCounts {
  assetClasses: number;
  telemetryPoints: number;
  telemetryRules: number;
  /** Classes whose `model_key` was filled in (a new class carries its key, so it is not counted). */
  modelKeys: number;
}

/** What a fresh seed inserted of the equipment: the catalogue, then the assets standing in it. */
interface SeededCounts extends CatalogueCounts {
  assets: number;
}

/** What a top-up added to an already seeded demo campus. */
interface TopUp extends SeededCounts {
  zones: number;
  zoneUses: number;
  zoneHeights: number;
  cameras: number;
  siteFeatures: number;
  fieldsOfView: number;
}

/**
 * Seeds the reference campus when `SEED_ON_BOOT` is on: all of it into an empty database, or the
 * parts added since (the site plan, camera fields of view, the zones of the expanded campus, the
 * use and height of their buildings and their cameras, the equipment catalogue and the demo
 * assets) into a database seeded before them, so a demo volume upgrades by restarting (ADR-0017).
 * A top-up only fills what is missing — it never changes a value already there, with one bounded
 * exception: a class's `model_key` is also replaced when it holds a key this seed wrote earlier
 * (`SUPERSEDED_MODEL_KEYS`), never one an operator set — and only on the reference campus.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('SEED_ON_BOOT', { infer: true })) return;
    if (await this.isComplete(this.dataSource.manager)) return;

    const outcome = await this.dataSource.transaction(async (manager) => {
      // Replicas booting together all saw the same state above. The lock lets one seed; the others
      // wait for its commit, then find nothing left to do. The wait is capped by the 5 s
      // `lock_timeout`; seeding the campus takes a fraction of that.
      await manager.query('SELECT pg_advisory_xact_lock($1)', [AdvisoryLocks.Seed]);
      if ((await manager.count(ZoneEntity)) === 0) {
        return { seeded: await this.seed(manager, new Date()) };
      }
      return this.topUp(manager);
    });

    if (outcome && 'seeded' in outcome) {
      const { assetClasses, telemetryPoints, telemetryRules, assets } = outcome.seeded;
      this.logger.log(
        `Seeded ${ZONES.length} zones, ${CAMERAS.length} cameras, ${INCIDENTS.length} incidents, ` +
          `the site plan, ${assetClasses} asset classes, ${telemetryPoints} points, ` +
          `${telemetryRules} rules and ${assets} assets`,
      );
    } else if (outcome && Object.values(outcome).some((count) => count > 0)) {
      this.logger.log(
        `Topped up the seeded campus: ${outcome.zones} zones, ${outcome.zoneUses} zone uses, ` +
          `${outcome.zoneHeights} zone heights, ${outcome.cameras} cameras, ` +
          `${outcome.siteFeatures} site plan features, ` +
          `${outcome.fieldsOfView} camera fields of view, ` +
          `${outcome.assetClasses} asset classes, ${outcome.modelKeys} model keys, ` +
          `${outcome.telemetryPoints} points, ${outcome.telemetryRules} rules, ${outcome.assets} assets`,
      );
    }
  }

  /** Seeds an empty database; returns what the catalogue and asset steps inserted, for the log. */
  async seed(manager: EntityManager, now: Date): Promise<SeededCounts> {
    const zones = new Map<string, ZoneEntity>();
    for (const seed of ZONES) {
      const zone = await manager.save(manager.create(ZoneEntity, zoneColumns(seed)));
      zones.set(seed.code, zone);
    }

    for (const seed of CAMERAS) {
      const zone = zones.get(seed.zone)!;
      await manager.save(manager.create(CameraEntity, cameraColumns(seed, zone)));
    }

    await this.seedSitePlan(manager);
    // The routines a top-up uses, so a fresh seed and a top-up cannot disagree; on an empty
    // database everything is absent. Assets after the zones and the classes they restrict.
    const catalogue = await this.addMissingCatalogue(manager);
    const assets = await this.addMissingAssets(manager);

    // Oldest first, so codes increase with time like they would in production. The people in the
    // seed story are fictional, so their timeline entries name the `seed` system actor.
    const actor = SystemActors.seed;
    for (const seed of [...INCIDENTS].sort((a, b) => b.minutesAgo - a.minutesAgo)) {
      const zone = zones.get(seed.zone)!;
      const reportedAt = new Date(now.getTime() - seed.minutesAgo * MINUTE);
      const [lng, lat] = offset(zone.center, 6, -4);
      const incident = IncidentEntity.report(
        {
          code: await nextIncidentCode(manager),
          type: seed.type,
          severity: seed.severity,
          title: seed.title,
          description: seed.description,
          zoneId: zone.id,
          lng,
          lat,
          source: 'operator',
          at: reportedAt,
        },
        actor,
      );
      if (seed.acknowledgedAfter !== undefined) {
        incident.acknowledge(
          new Date(reportedAt.getTime() + seed.acknowledgedAfter * MINUTE),
          actor,
        );
      }
      if (seed.resolvedAfter !== undefined) {
        incident.resolve(
          new Date(reportedAt.getTime() + seed.resolvedAfter * MINUTE),
          actor,
          seed.resolution ?? null,
        );
      }
      await persistIncident(manager, incident);
    }
    return { ...catalogue, assets };
  }

  /**
   * Lock-free check that a boot has nothing to seed, so an up-to-date demo boot never queues on the
   * seed lock. A database that is not the reference campus lacks some seed zone or camera, so it
   * fails this check and takes the lock, then `topUp` finds nothing to do. A missing catalogue
   * class, point or rule fails it too, read through the same `missingFromCatalogue` the top-up
   * inserts from, so the check and the filler cannot disagree. So does a missing seed asset, by
   * code, so an asset added by hand cannot hide one.
   */
  private async isComplete(manager: EntityManager): Promise<boolean> {
    if ((await manager.count(ZoneEntity)) === 0) return false;
    if ((await manager.count(SiteEntity)) === 0) return false;
    const seedZones = await manager.count(ZoneEntity, { where: { code: In(SEED_ZONE_CODES) } });
    if (seedZones < SEED_ZONE_CODES.length) return false;
    // `kind` as in `topUpZones`: a seed zone an operator re-typed is never filled in, so it must
    // not keep the campus "incomplete" and send every boot to the lock.
    const zonesWithoutValues = await manager.count(ZoneEntity, {
      where: [
        { code: In(USE_SEED_CODES), kind: 'building', use: IsNull() },
        { code: In(HEIGHT_SEED_CODES), kind: 'building', heightM: IsNull() },
      ],
    });
    if (zonesWithoutValues > 0) return false;
    // The check below only sees cameras that exist, so a missing seed camera needs its own count.
    const seedCameras = await manager.count(CameraEntity, {
      where: { code: In(SEED_CAMERA_CODES) },
    });
    if (seedCameras < SEED_CAMERA_CODES.length) return false;
    const camerasWithoutFov = await manager.count(CameraEntity, {
      where: { code: In(SEED_CAMERA_CODES), fovHeadingDeg: IsNull() },
    });
    if (camerasWithoutFov > 0) return false;
    // Like cameras, a missing seed asset needs its own check: nothing above would notice it.
    if (!(await this.assetsAreComplete(manager))) return false;
    return this.catalogueIsComplete(manager);
  }

  /**
   * Adds what a campus seeded before the expanded zones and cameras, the site plan, camera fields
   * of view, the equipment catalogue and its assets lacks. `null` when the database is not the
   * reference campus: the seed's data would not belong there. That is the nine zones of the first
   * campus, not every zone seeded since (a volume seeded before the expanded zones has only those
   * nine).
   */
  private async topUp(manager: EntityManager): Promise<TopUp | null> {
    const referenceZones = await manager.count(ZoneEntity, {
      where: { code: In([...REFERENCE_ZONE_CODES]) },
    });
    if (referenceZones < REFERENCE_ZONE_CODES.length) return null;

    const zones = await this.topUpZones(manager);
    // After the zones, so every seed camera's zone exists; before the loop below, which then finds
    // the inserted cameras with their field of view already set.
    const cameras = await this.topUpCameras(manager);
    const hasSite = (await manager.count(SiteEntity)) > 0;
    const featureCount = hasSite ? 0 : await this.seedSitePlan(manager);

    let fieldsOfView = 0;
    for (const seed of CAMERAS) {
      // Only cameras whose field of view is still unknown: a value set since is kept.
      const result = await manager.update(
        CameraEntity,
        { code: seed.code, fovHeadingDeg: IsNull() },
        fieldOfViewColumns(seed.fov),
      );
      fieldsOfView += result.affected ?? 0;
    }
    const catalogue = await this.addMissingCatalogue(manager);
    // Last: an asset restricts its zone and its class, and both exist now.
    const assets = await this.addMissingAssets(manager);
    return { ...zones, cameras, siteFeatures: featureCount, fieldsOfView, ...catalogue, assets };
  }

  /**
   * What the database holds of the seed classes: the class codes with their current `model_key`,
   * and the points and class rules of those classes as `pointRef` / `ruleRef` keys. `classIds` maps
   * a class code to its row.
   * Narrow reads (a few columns of at most 16 classes, 66 points and 22 rules), no relation joins.
   */
  private async readCatalogue(
    manager: EntityManager,
  ): Promise<{ present: PresentCatalogue; classIds: Map<string, string> }> {
    const classes = await manager.find(AssetClassEntity, {
      select: { id: true, code: true, modelKey: true },
      where: { code: In(SEED_CLASS_CODES) },
    });
    const classIds = new Map(classes.map((row) => [row.code, row.id]));
    const points = new Set<string>();
    const rules = new Set<string>();
    const modelKeys = new Map(classes.map((row) => [row.code, row.modelKey]));
    const present = { classes: new Set(classIds.keys()), points, rules, modelKeys };
    // No seed class yet: nothing hangs off one, and `In([])` is best not relied on.
    if (classes.length === 0) return { present, classIds };

    const codeById = new Map(classes.map((row) => [row.id, row.code]));
    const ids = classes.map((row) => row.id);
    const pointRows = await manager.find(TelemetryPointEntity, {
      select: { assetClassId: true, key: true },
      where: { assetClassId: In(ids) },
    });
    for (const row of pointRows) {
      points.add(pointRef(codeById.get(row.assetClassId)!, row.key));
    }
    // Class rules only: an override (`assetId` set) is not the seed's and never matches a seed name.
    const ruleRows = await manager.find(TelemetryRuleEntity, {
      select: { assetClassId: true, name: true },
      where: { assetClassId: In(ids), assetId: IsNull() },
    });
    for (const row of ruleRows) {
      rules.add(ruleRef(codeById.get(row.assetClassId)!, row.name));
    }
    return { present, classIds };
  }

  private async catalogueIsComplete(manager: EntityManager): Promise<boolean> {
    const { present } = await this.readCatalogue(manager);
    const missing = missingFromCatalogue(present);
    return (
      missing.classes.length +
        missing.points.length +
        missing.rules.length +
        missing.modelKeys.length ===
      0
    );
  }

  /**
   * Inserts the seed classes, points and class rules that are absent. A row that exists is never
   * rewritten, and only absent ones are inserted, so a threshold an operator changed is kept and
   * nothing collides with a unique key. On an empty database that is all of it.
   *
   * The one value of an existing row it does write is a class's `model_key`, and only where it is
   * `NULL` or a key this seed wrote before (`SUPERSEDED_MODEL_KEYS`): the update's `where` repeats
   * that guard, so a key set between the read and the write is still kept.
   */
  private async addMissingCatalogue(manager: EntityManager): Promise<CatalogueCounts> {
    const { present, classIds } = await this.readCatalogue(manager);
    const missing = missingFromCatalogue(present);

    // Classes first: a point and a rule need their class's id. `fk_telemetry_rule_point` is
    // deferred, so a rule whose key is no point of its class is refused at commit, not at its
    // insert, and fails the whole boot transaction; the data spec is what guards it.
    if (missing.classes.length > 0) {
      const saved = await manager.save(
        missing.classes.map((seed) => manager.create(AssetClassEntity, classColumns(seed))),
      );
      for (const row of saved) classIds.set(row.code, row.id);
    }
    if (missing.points.length > 0) {
      await manager.save(
        missing.points.map(({ assetClass, point }) =>
          manager.create(TelemetryPointEntity, pointColumns(point, classIds.get(assetClass.code)!)),
        ),
      );
    }
    if (missing.rules.length > 0) {
      await manager.save(
        missing.rules.map(({ assetClass, rule }) =>
          manager.create(TelemetryRuleEntity, ruleColumns(rule, classIds.get(assetClass.code)!)),
        ),
      );
    }

    let modelKeys = 0;
    for (const seed of missing.modelKeys) {
      // `In([])` is best not relied on, and the list is empty until the first key is superseded.
      const superseded = SUPERSEDED_MODEL_KEYS[seed.code] ?? [];
      const result = await manager.update(
        AssetClassEntity,
        {
          code: seed.code,
          modelKey: superseded.length > 0 ? Or(IsNull(), In(superseded)) : IsNull(),
        },
        { modelKey: seed.modelKey },
      );
      modelKeys += result.affected ?? 0;
    }
    return {
      assetClasses: missing.classes.length,
      telemetryPoints: missing.points.length,
      telemetryRules: missing.rules.length,
      modelKeys,
    };
  }

  /** The seed asset codes the database holds: the one read the check and the filler share. */
  private async presentAssetCodes(manager: EntityManager): Promise<Set<string>> {
    const rows = await manager.find(AssetEntity, {
      select: { code: true },
      where: { code: In(SEED_ASSET_CODES) },
    });
    return new Set(rows.map((row) => row.code));
  }

  private async assetsAreComplete(manager: EntityManager): Promise<boolean> {
    return (await this.presentAssetCodes(manager)).size >= SEED_ASSET_CODES.length;
  }

  /**
   * Inserts the seed assets that are absent. An asset that exists is never rewritten, and only
   * absent codes are inserted, so a custom asset holding a seed code is left alone and nothing
   * collides with the unique `code`. The asset's zone and class restrict their deletion, so the
   * caller runs this after the zones and the catalogue.
   */
  private async addMissingAssets(manager: EntityManager): Promise<number> {
    const present = await this.presentAssetCodes(manager);
    const missing = ASSETS.filter((seed) => !present.has(seed.code));
    if (missing.length === 0) return 0;

    // Every class and zone exists here: the catalogue and the zone steps ran first.
    const classes = new Map(
      (
        await manager.find(AssetClassEntity, {
          select: { id: true, code: true },
          where: { code: In(missing.map((seed) => seed.class)) },
        })
      ).map((row) => [row.code, row.id]),
    );
    const zones = new Map(
      (
        await manager.find(ZoneEntity, {
          select: { id: true, code: true },
          where: { code: In(missing.map((seed) => seed.zone)) },
        })
      ).map((row) => [row.code, row.id]),
    );
    await manager.save(
      missing.map((seed) =>
        manager.create(
          AssetEntity,
          assetColumns(seed, classes.get(seed.class)!, zones.get(seed.zone)!),
        ),
      ),
    );
    return missing.length;
  }

  /**
   * Inserts the seed cameras that are absent, with their field of view. A camera that exists is
   * never rewritten, and only absent codes are inserted, so a custom camera holding a seed code is
   * left alone and nothing collides with the unique `code`.
   */
  private async topUpCameras(manager: EntityManager): Promise<number> {
    const present = new Set(
      (
        await manager.find(CameraEntity, {
          select: { code: true },
          where: { code: In(SEED_CAMERA_CODES) },
        })
      ).map((camera) => camera.code),
    );
    const missing = CAMERAS.filter((seed) => !present.has(seed.code));
    if (missing.length === 0) return 0;

    // Every seed zone exists here (`topUpZones` inserted the absent ones), as in `seed()`.
    const zones = new Map(
      (
        await manager.find(ZoneEntity, {
          select: { id: true, code: true, centerLng: true, centerLat: true },
          where: { code: In(missing.map((seed) => seed.zone)) },
        })
      ).map((zone) => [zone.code, zone]),
    );
    await manager.save(
      missing.map((seed) =>
        manager.create(CameraEntity, cameraColumns(seed, zones.get(seed.zone)!)),
      ),
    );
    return missing.length;
  }

  /**
   * Inserts the seed zones that are absent and fills the use and height still unknown on those that
   * exist. A zone that exists is never rewritten otherwise. Only absent codes are inserted, so a
   * custom zone holding a seed code is left alone and nothing collides with the unique `code`.
   */
  private async topUpZones(
    manager: EntityManager,
  ): Promise<Pick<TopUp, 'zones' | 'zoneUses' | 'zoneHeights'>> {
    const present = new Set(
      (
        await manager.find(ZoneEntity, {
          select: { code: true },
          where: { code: In(SEED_ZONE_CODES) },
        })
      ).map((zone) => zone.code),
    );
    const missing = ZONES.filter((seed) => !present.has(seed.code));
    if (missing.length > 0) {
      await manager.save(missing.map((seed) => manager.create(ZoneEntity, zoneColumns(seed))));
    }

    let zoneUses = 0;
    let zoneHeights = 0;
    for (const seed of ZONES.filter((zone) => present.has(zone.code))) {
      // Only a value still unknown, and only on the kind the seed gave it: a value set since is
      // kept, and a zone re-typed since must not get a use, which `zone_use_check` would refuse and
      // so fail the boot of every replica.
      if (seed.use !== undefined) {
        const result = await manager.update(
          ZoneEntity,
          { code: seed.code, kind: seed.kind, use: IsNull() },
          { use: seed.use },
        );
        zoneUses += result.affected ?? 0;
      }
      if (seed.heightM !== undefined) {
        const result = await manager.update(
          ZoneEntity,
          { code: seed.code, kind: seed.kind, heightM: IsNull() },
          { heightM: seed.heightM },
        );
        zoneHeights += result.affected ?? 0;
      }
    }
    return { zones: missing.length, zoneUses, zoneHeights };
  }

  /** Inserts `SITE` with its features; returns how many features. */
  private async seedSitePlan(manager: EntityManager): Promise<number> {
    const [centerLng, centerLat] = CAMPUS_CENTER;
    const site = await manager.save(
      manager.create(SiteEntity, { code: SITE.code, name: SITE.name, centerLng, centerLat }),
    );
    const features = siteFeatures();
    await manager.save(
      features.map((feature) => manager.create(SiteFeatureEntity, { siteId: site.id, ...feature })),
    );
    return features.length;
  }
}
