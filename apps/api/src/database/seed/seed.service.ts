import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CameraFieldOfView } from '@occ/contracts';
import { DataSource, type EntityManager, In, IsNull } from 'typeorm';
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
  CAMERAS,
  CAMPUS_CENTER,
  INCIDENTS,
  SITE,
  siteFeatures,
  ZONES,
  zoneCenter,
  zonePolygon,
} from './campus';

const MINUTE = 60_000;

const SEED_ZONE_CODES = ZONES.map((zone) => zone.code);
const SEED_CAMERA_CODES = CAMERAS.map((camera) => camera.code);

const fieldOfViewColumns = ({ heading, angle, range }: CameraFieldOfView) => ({
  fovHeadingDeg: heading,
  fovAngleDeg: angle,
  fovRangeM: range,
});

/** What a top-up added to an already seeded demo campus. */
interface TopUp {
  siteFeatures: number;
  fieldsOfView: number;
}

/**
 * Seeds the reference campus when `SEED_ON_BOOT` is on: all of it into an empty database, or the
 * parts added since (the site plan, camera fields of view) into a database seeded before them, so a
 * demo volume upgrades by restarting (ADR-0017). A top-up only fills what is missing — it never
 * changes a value already there — and only on the reference campus.
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
        await this.seed(manager, new Date());
        return 'seeded' as const;
      }
      return this.topUp(manager);
    });

    if (outcome === 'seeded') {
      this.logger.log(
        `Seeded ${ZONES.length} zones, ${CAMERAS.length} cameras, ${INCIDENTS.length} incidents ` +
          `and the site plan`,
      );
    } else if (outcome && (outcome.siteFeatures > 0 || outcome.fieldsOfView > 0)) {
      this.logger.log(
        `Topped up the seeded campus: ${outcome.siteFeatures} site plan features, ` +
          `${outcome.fieldsOfView} camera fields of view`,
      );
    }
  }

  async seed(manager: EntityManager, now: Date): Promise<void> {
    const zones = new Map<string, ZoneEntity>();
    for (const seed of ZONES) {
      const [lng, lat] = zoneCenter(seed);
      const zone = await manager.save(
        manager.create(ZoneEntity, {
          code: seed.code,
          name: seed.name,
          kind: seed.kind,
          polygon: zonePolygon(seed),
          centerLng: lng,
          centerLat: lat,
        }),
      );
      zones.set(seed.code, zone);
    }

    for (const seed of CAMERAS) {
      const zone = zones.get(seed.zone)!;
      const [lng, lat] = offset(zone.center, ...seed.at);
      await manager.save(
        manager.create(CameraEntity, {
          code: seed.code,
          name: seed.name,
          zoneId: zone.id,
          lng,
          lat,
          streamPath: `campus/${seed.code.toLowerCase()}`,
          online: seed.online ?? true,
          ...fieldOfViewColumns(seed.fov),
        }),
      );
    }

    await this.seedSitePlan(manager);

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
  }

  /**
   * Lock-free check that a boot has nothing to seed, so an up-to-date demo boot never queues on the
   * seed lock. A database that is not the reference campus has no site plan from the seed, so it
   * fails this check and takes the lock, then `topUp` finds nothing to do.
   */
  private async isComplete(manager: EntityManager): Promise<boolean> {
    if ((await manager.count(ZoneEntity)) === 0) return false;
    if ((await manager.count(SiteEntity)) === 0) return false;
    const camerasWithoutFov = await manager.count(CameraEntity, {
      where: { code: In(SEED_CAMERA_CODES), fovHeadingDeg: IsNull() },
    });
    return camerasWithoutFov === 0;
  }

  /**
   * Adds what a campus seeded before the site plan and camera fields of view lacks. `null` when the
   * database is not the reference campus: the seed's data would not belong there.
   */
  private async topUp(manager: EntityManager): Promise<TopUp | null> {
    const seedZones = await manager.count(ZoneEntity, { where: { code: In(SEED_ZONE_CODES) } });
    if (seedZones < SEED_ZONE_CODES.length) return null;

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
    return { siteFeatures: featureCount, fieldsOfView };
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
