import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  INCIDENT_SEVERITIES,
  type Incident,
  type IncidentDetail,
  IncidentEvents,
  type IncidentSource,
  type ListIncidentsQuery,
  type ReportIncidentRequest,
} from '@occ/contracts';
import { DataSource } from 'typeorm';
import { EntityNotFoundError } from '../common/domain-errors';
import { ZoneEntity } from '../zones/zone.entity';
import { nextIncidentCode } from './incident-code';
import { IncidentEntity } from './incident.entity';
import { persistIncident } from './persist-incident';

const DEFAULT_LIMIT = 100;
const SEVERITY_ORDER = `ARRAY[${INCIDENT_SEVERITIES.map((s) => `'${s}'`).join(',')}]::varchar[]`;

/**
 * Application service for incidents. Every write runs in one transaction and publishes a
 * domain event *after* commit — listeners (e.g. the WebSocket gateway) never see rolled-back state.
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  /** Unresolved first, then most severe, then newest. */
  async list(query: ListIncidentsQuery = {}): Promise<Incident[]> {
    const qb = this.dataSource.getRepository(IncidentEntity).createQueryBuilder('incident');
    if (query.status?.length)
      qb.andWhere('incident.status IN (:...status)', { status: query.status });
    if (query.severity?.length) {
      qb.andWhere('incident.severity IN (:...severity)', { severity: query.severity });
    }
    const incidents = await qb
      .orderBy(`CASE WHEN incident.status = 'resolved' THEN 1 ELSE 0 END`, 'ASC')
      .addOrderBy(`array_position(${SEVERITY_ORDER}, incident.severity)`, 'DESC')
      .addOrderBy('incident.reportedAt', 'DESC')
      .limit(query.limit ?? DEFAULT_LIMIT)
      .getMany();
    return incidents.map((incident) => incident.toContract());
  }

  async get(id: string): Promise<IncidentDetail> {
    const incident = await this.dataSource.getRepository(IncidentEntity).findOne({
      where: { id },
      relations: { timeline: true },
    });
    if (!incident) throw new EntityNotFoundError('Incident', id);
    return incident.toDetailContract();
  }

  async report(request: ReportIncidentRequest, source: IncidentSource): Promise<IncidentDetail> {
    const incident = await this.dataSource.transaction(async (manager) => {
      const zone = await manager.findOneBy(ZoneEntity, { id: request.zoneId });
      if (!zone) throw new EntityNotFoundError('Zone', request.zoneId);
      const [lng, lat] = request.position ?? zone.center;

      return persistIncident(
        manager,
        IncidentEntity.report({
          code: await nextIncidentCode(manager),
          type: request.type,
          severity: request.severity,
          title: request.title,
          description: request.description,
          zoneId: zone.id,
          lng,
          lat,
          source,
          at: this.now(),
        }),
      );
    });

    this.events.emit(IncidentEvents.Created, incident.toContract());
    return this.get(incident.id);
  }

  acknowledge(id: string, note?: string): Promise<IncidentDetail> {
    return this.transition(id, (incident, at) => incident.acknowledge(at, note ?? null));
  }

  resolve(id: string, note?: string): Promise<IncidentDetail> {
    return this.transition(id, (incident, at) => incident.resolve(at, note ?? null));
  }

  /** Loads the incident under a row lock so concurrent operators cannot both transition it. */
  private async transition(
    id: string,
    apply: (incident: IncidentEntity, at: Date) => void,
  ): Promise<IncidentDetail> {
    const incident = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(IncidentEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new EntityNotFoundError('Incident', id);
      apply(locked, this.now());
      return persistIncident(manager, locked);
    });

    this.events.emit(IncidentEvents.Updated, incident.toContract());
    return this.get(id);
  }

  /** Overridable clock — keeps time-dependent behaviour testable. */
  protected now(): Date {
    return new Date();
  }
}
