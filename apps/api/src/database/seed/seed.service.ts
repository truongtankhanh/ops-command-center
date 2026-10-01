import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import { CameraEntity } from '../../cameras/camera.entity';
import { offset } from '../../common/geo';
import type { Env } from '../../config/env.validation';
import { nextIncidentCode } from '../../incidents/incident-code';
import { IncidentEntity } from '../../incidents/incident.entity';
import { persistIncident } from '../../incidents/persist-incident';
import { ZoneEntity } from '../../zones/zone.entity';
import { CAMERAS, INCIDENTS, ZONES, zoneCenter, zonePolygon } from './campus';

const MINUTE = 60_000;

/** Seeds the reference campus once, when the database is empty and `SEED_ON_BOOT` is on. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('SEED_ON_BOOT', { infer: true })) return;
    if ((await this.dataSource.getRepository(ZoneEntity).count()) > 0) return;

    await this.dataSource.transaction((manager) => this.seed(manager, new Date()));
    this.logger.log(
      `Seeded ${ZONES.length} zones, ${CAMERAS.length} cameras, ${INCIDENTS.length} incidents`,
    );
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
        }),
      );
    }

    // Oldest first, so codes increase with time like they would in production.
    for (const seed of [...INCIDENTS].sort((a, b) => b.minutesAgo - a.minutesAgo)) {
      const zone = zones.get(seed.zone)!;
      const reportedAt = new Date(now.getTime() - seed.minutesAgo * MINUTE);
      const [lng, lat] = offset(zone.center, 6, -4);
      const incident = IncidentEntity.report({
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
      });
      if (seed.acknowledgedAfter !== undefined) {
        incident.acknowledge(new Date(reportedAt.getTime() + seed.acknowledgedAfter * MINUTE));
      }
      if (seed.resolvedAfter !== undefined) {
        incident.resolve(
          new Date(reportedAt.getTime() + seed.resolvedAfter * MINUTE),
          seed.resolution ?? null,
        );
      }
      await persistIncident(manager, incident);
    }
  }
}
