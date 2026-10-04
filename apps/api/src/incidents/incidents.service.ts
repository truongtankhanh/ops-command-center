import { Injectable } from '@nestjs/common';
import {
  INCIDENT_SEVERITIES,
  type Incident,
  type IncidentDetail,
  IncidentEvents,
  type IncidentSource,
  type ListIncidentsQuery,
  type ReportIncidentRequest,
} from '@occ/contracts';
import { DataSource, type EntityManager } from 'typeorm';
import { EntityNotFoundError } from '../common/domain-errors';
import { OutboxRelay } from '../outbox/outbox-relay.service';
import { ZoneEntity } from '../zones/zone.entity';
import { DEFAULT_INCIDENT_LIMIT } from './dto/incident-requests.dto';
import { claimIdempotencyKey, fingerprint, storeIdempotentResponse } from './idempotency';
import { nextIncidentCode } from './incident-code';
import { IncidentEntity } from './incident.entity';
import { persistIncident } from './persist-incident';

const SEVERITY_ORDER = `ARRAY[${INCIDENT_SEVERITIES.map((s) => `'${s}'`).join(',')}]::varchar[]`;

/**
 * Application service for incidents. Every write runs in one transaction that also records its
 * domain event in the outbox, so an event exists exactly when its change committed. `OutboxRelay`
 * publishes it to listeners (e.g. the WebSocket gateway); this service only nudges it (ADR-0007).
 * Reporting with an idempotency key is safe to retry: the same key returns the first response
 * instead of creating a second incident (ADR-0009).
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxRelay,
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
      .limit(query.limit ?? DEFAULT_INCIDENT_LIMIT)
      .getMany();
    return incidents.map((incident) => incident.toContract());
  }

  get(id: string): Promise<IncidentDetail> {
    return this.loadDetail(this.dataSource.manager, id);
  }

  /**
   * With `idempotencyKey`, a repeat of the same request returns the stored first response and
   * creates nothing; the same key with a different body throws `IdempotencyKeyReusedError`.
   */
  async report(
    request: ReportIncidentRequest,
    source: IncidentSource,
    idempotencyKey?: string,
  ): Promise<IncidentDetail> {
    const idempotency = idempotencyKey
      ? { key: idempotencyKey, requestHash: fingerprint(request) }
      : undefined;

    const { detail, created } = await this.dataSource.transaction(async (manager) => {
      // Before the zone lookup and `nextval`, so a replay burns no incident code.
      if (idempotency) {
        const claim = await claimIdempotencyKey(manager, idempotency.key, idempotency.requestHash);
        if (!claim.claimed) return { detail: claim.body, created: false };
      }

      const zone = await manager.findOneBy(ZoneEntity, { id: request.zoneId });
      if (!zone) throw new EntityNotFoundError('Zone', request.zoneId);
      const [lng, lat] = request.position ?? zone.center;

      const incident = await persistIncident(
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
        IncidentEvents.Created,
      );
      // Read inside the transaction: the stored response must commit together with the incident.
      const detail = await this.loadDetail(manager, incident.id);
      if (idempotency) await storeIdempotentResponse(manager, idempotency.key, detail);
      return { detail, created: true };
    });

    if (created) void this.outbox.drain();
    return detail;
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
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(IncidentEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new EntityNotFoundError('Incident', id);
      apply(locked, this.now());
      await persistIncident(manager, locked, IncidentEvents.Updated);
    });

    void this.outbox.drain();
    return this.get(id);
  }

  private async loadDetail(manager: EntityManager, id: string): Promise<IncidentDetail> {
    const incident = await manager.findOne(IncidentEntity, {
      where: { id },
      relations: { timeline: true },
    });
    if (!incident) throw new EntityNotFoundError('Incident', id);
    return incident.toDetailContract();
  }

  /** Overridable clock — keeps time-dependent behaviour testable. */
  protected now(): Date {
    return new Date();
  }
}
